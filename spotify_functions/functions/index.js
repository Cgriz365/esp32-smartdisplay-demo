const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https"); // <-- ADD HttpsError HERE!
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { getStorage } = require('firebase-admin/storage');
const logger = require("firebase-functions/logger");

const admin = require("firebase-admin");
const axios = require("axios");
const sharp = require('sharp');

// --- Initialization ---
// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();


// Set the region for all functions
setGlobalOptions({ region: "us-central1" });

// IMPORTANT: These will now be read from Firestore, not process.env
let spotifyClientId = null;
let spotifyClientSecret = null;

// The URL where your login page will be hosted.
const REDIRECT_URI = `https://spotifycallback-pxaqsveupq-uc.a.run.app`; // Keep this for Spotify's redirect
const USER_URI = "lMyvLUyFUTaYV6upLsRAjf7SMwV2"; // This is the user URI for Firestore paths

const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-email",
  "playlist-read-private",
  "user-library-read",
  "streaming",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

async function loadSpotifyCredentials() {
  if (spotifyClientId && spotifyClientSecret) {
    return; // Already loaded
  }
  try {
    const configDoc = await db.collection("app_config").doc("spotify_api").get();
    if (configDoc.exists) {
      const data = configDoc.data();
      spotifyClientId = data.clientId;
      spotifyClientSecret = data.clientSecret;
      logger.log("Spotify credentials loaded from Firestore.");
    } else {
      // If the document doesn't exist, it's not a fatal error for startup.
      // Functions relying on these will then explicitly check for null/undefined.
      logger.warn("Spotify API credentials not found in Firestore. Please set them up in app_config/spotify_api.");
      spotifyClientId = null; // Ensure variables are cleared
      spotifyClientSecret = null;
    }
  } catch (error) {
    // THIS IS THE CRITICAL PART FOR GLOBAL INIT FAILURES:
    // DO NOT THROW if this function can be called implicitly during global file loading.
    logger.error("Error loading Spotify API credentials from Firestore during global initialization:", error);
    // Ensure credentials are null if there's an error, so dependent functions can handle it.
    spotifyClientId = null;
    spotifyClientSecret = null;
    // Do NOT re-throw here. If a function later needs these, it will check for null.
  }
}

// --- NEW FUNCTION: To receive Client ID and Secret from a web form ---
exports.setSpotifyCredentials = onRequest(
  { cors: true },
  async (req, res) => {


    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { clientId, clientSecret } = req.body;

    if (!clientId || !clientSecret) {
      res.status(400).send('Client ID and Client Secret are required.');
      return;
    }

    try {
      await db.collection("app_config").doc("spotify_api").set({
        clientId: clientId,
        clientSecret: clientSecret,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      // After setting, immediately update the in-memory variables
      spotifyClientId = clientId;
      spotifyClientSecret = clientSecret;
      res.status(200).send('Spotify credentials saved successfully!');
    } catch (error) {
      logger.error("Error saving Spotify credentials:", error);
      res.status(500).send('Failed to save Spotify credentials.');
    }
  });


// --- 1. Authentication Functions (User-facing, run once from a browser) ---

/**
 * HTTP Function to initiate the Spotify Login flow.
 * This redirects the user to Spotify's authorization page.
 */
exports.spotifyLogin = onRequest({ cors: true }, async (req, res) => {
  await loadSpotifyCredentials(); // Ensure credentials are loaded

  if (!spotifyClientId) {
    res.status(500).send('Spotify Client ID is not set. Please configure it first.');
    return;
  }

  const authUrl =
    "https://accounts.spotify.com/authorize?" + // Correct Spotify auth URL
    new URLSearchParams({
      response_type: "code",
      client_id: spotifyClientId,
      scope: SPOTIFY_SCOPES,
      redirect_uri: REDIRECT_URI,
    }).toString();

  res.redirect(authUrl);
});

/**
 * HTTP Function that Spotify calls back to after the user authorizes the app.
 * It exchanges the authorization code for an access token and refresh token.
 */
exports.spotifyCallback = onRequest(async (req, res) => {
  await loadSpotifyCredentials(); // Ensure credentials are loaded

  if (!spotifyClientId || !spotifyClientSecret) {
    res.status(500).send('Spotify Client ID or Secret is not set. Please configure them first.');
    return;
  }

  const { code, error } = req.query;

  if (error) {
    res.status(400).send(`Error from Spotify: ${error}`);
    return;
  }

  if (!code) {
    res.status(400).send("No authorization code provided.");
    return;
  }

  try {
    const tokenResponse = await axios({
      method: "post",
      url: "https://accounts.spotify.com/api/token", // Correct Spotify token URL
      params: {
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
      },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(spotifyClientId + ":" + spotifyClientSecret).toString(
            "base64"
          ),
      },
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    const credentialsRef = db.collection("spotify_credentials").doc("user_tokens");
    await credentialsRef.set({
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + expires_in * 1000
      ),
    });

    res.status(200).send("Authentication successful! You can close this window. Your device is now linked.");
  } catch (err) {
    logger.error("Error exchanging code for token:", err.response?.data || err.message);
    res.status(500).send("Failed to get tokens from Spotify.");
  }
});


// --- 2. Helper function to get a valid access token (refreshes if needed) ---
async function getValidAccessToken() {
  await loadSpotifyCredentials(); // Ensure credentials are loaded

  if (!spotifyClientId || !spotifyClientSecret) {
    logger.error('Spotify Client ID or Secret is not set. Cannot get valid access token.');
    throw new Error('Spotify API credentials are not configured.');
  }

  const credentialsRef = db.collection("spotify_credentials").doc("user_tokens");
  const doc = await credentialsRef.get();

  if (!doc.exists) {
    logger.error("Spotify credentials not found. Please log in first.");
    throw new Error("Spotify credentials not found. Please log in first.");
  }

  const data = doc.data();
  const now = admin.firestore.Timestamp.now();

  if (now.toMillis() > data.expiresAt.toMillis() - 60000) {
    logger.log("Access token expired, refreshing...");
    try {
      const tokenResponse = await axios({
        method: 'post',
        url: 'https://accounts.spotify.com/api/token', // Correct Spotify token URL
        params: {
          grant_type: 'refresh_token',
          refresh_token: data.refreshToken,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(spotifyClientId + ':' + spotifyClientSecret).toString('base64'),
        },
      });

      const { access_token, expires_in } = tokenResponse.data;
      await credentialsRef.update({
        accessToken: access_token,
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + expires_in * 1000),
      });
      logger.log("Token refreshed successfully.");
      return access_token;
    } catch (error) {
      logger.error('Error refreshing token:', error.response?.data || error.message);
      throw new Error('Could not refresh Spotify token.');
    }
  }

  return data.accessToken;
}


// --- 3. Data Fetching and Control Functions (Callable from ESP32 via Firestore triggers) ---

/**
 * Fetches the user's playlists from Spotify and saves them to Firestore.
 * Triggered when a document is created/written in the 'commands/fetch_playlists' path.
 */
exports.fetchPlaylists = onDocumentWritten("commands/fetch_saved_playlists", async (event) => {
  // We only care about document creation or updates, not deletions
  if (!event.data.after.exists) {
    return;
  }

  logger.log("`fetchPlaylists` command received. Fetching from Spotify...");

  try {
    const accessToken = await getValidAccessToken();
    const response = await axios.get("https://api.spotify.com/v1/me/playlists", { // Correct Spotify API URL
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 50 }
    });

    const playlists = response.data.items.map(playlist => ({
      id: playlist.id,
      name: playlist.name,
      imageUrl: playlist.images[0]?.url || null,
      uri: playlist.uri,
    }));

    const dataRef = db.collection("spotify_data").doc("playlists");
    await dataRef.set({
      items: playlists,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });

    logger.log("Successfully fetched and stored user playlists.");
    // Clean up the command document
    await event.data.after.ref.delete();

  } catch (error) {
    logger.error("Error fetching playlists:", error.response?.data || error.message);
  }
});

/**
 * Plays a specific playlist or album on the user's active Spotify device.
 * Triggered by writing to 'commands/play_item'.
 */
exports.playItem = onDocumentWritten("commands/play_item", async (event) => {
  if (!event.data.after.exists) {
    return;
  }

  const { context_uri } = event.data.after.data();

  if (!context_uri) {
    logger.error("Command received, but 'context_uri' was not provided.");
    await event.data.after.ref.delete();
    return;
  }

  logger.log(`'playItem' command received for URI: ${context_uri}`);

  try {
    const accessToken = await getValidAccessToken();
    await axios.put("https://api.spotify.com/v1/me/player/play", // Correct Spotify API URL
      {
        context_uri: context_uri
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

    logger.log("Playback command sent successfully.");
    await event.data.after.ref.delete();

  } catch (error) {
    logger.error("Error sending play command:", error.response?.data || error.message);
  }
});

const LV_COLOR_FORMAT_RGB565 = 0x0A; // Decimal 10
exports.processAlbumArt = onDocumentWritten(`process_album_art/{albumID}`, async (event) => {

    if (!event.data || !event.data.after.exists) {
      logger.log("Process album art command document deleted or invalid event data.");
      return;
    }

    // Access data from the document that triggered the function
    const { imageUrl, trackId } = event.data.after.data();
    // In v2, params are directly on the event object
    const docId = event.params.albumID; 
    const docRef = event.data.after.ref; // Get a reference to the triggering document

    // Validate input data
    if (!imageUrl || !trackId) {
      logger.error("Command invalid: 'imageUrl' and 'trackId' are required.", {
        docId: docId,
      });
      // Clean up the invalid command document
      await docRef.delete();
      return;
    }

    logger.log(`Processing album art for track: ${trackId} from URL: ${imageUrl}`);

    // Define the target resolution for the LVGL image
    const ART_RESOLUTION = 300; // The desired width and height for the final image.

    try {
      // 1. Download the image from the URL using axios
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer' // Get the raw image data as a buffer
      });

      const image = sharp(Buffer.from(imageResponse.data));

      const { data: rgbaBuffer, info } = await image
        .resize(ART_RESOLUTION, ART_RESOLUTION, { fit: 'cover' }) // Resize while maintaining aspect ratio
        .raw() // Output raw pixel data (typically 8-bit per channel, e.g., RGBA)
        .toBuffer({ resolveWithObject: true });

      logger.log(`Sharp raw output info:`, info);

      // Ensure the output width and height match the resized dimensions
      const finalWidth = info.width;
      const finalHeight = info.height;

      const rgb565Buffer = Buffer.alloc(finalWidth * finalHeight * 2); // Each RGB565 pixel is 2 bytes

      for (let i = 0; i < rgbaBuffer.length; i += info.channels) {
        const r8 = rgbaBuffer[i];     // Red (8-bit)
        const g8 = rgbaBuffer[i + 1]; // Green (8-bit)
        const b8 = rgbaBuffer[i + 2]; // Blue (8-bit)

        const r5 = (r8 >> 3) & 0x1F; // Extract top 5 bits for Red
        const g6 = (g8 >> 2) & 0x3F; // Extract top 6 bits for Green
        const b5 = (b8 >> 3) & 0x1F; // Extract top 5 bits for Blue

        // LVGL's RGB565 format is (R5 << 11) | (G6 << 5) | B5.
        // When written to a buffer as UInt16LE, this will correctly place
        // the bytes for ESP32 (which is typically little-endian).
        const rgb565_pixel = (r5 << 11) | (g6 << 5) | b5;

        const bufferIndex = (i / info.channels) * 2; // Calculate byte offset for current pixel
        rgb565Buffer.writeUInt16LE(rgb565_pixel, bufferIndex);
      }

      // --- Construct and Prepend LVGL Image Header ---
      // LVGL lv_image_header_t structure (4 bytes total)
      // Bitfield packing:
      // bit 0: always_0b0 (1 bit, should be 0 for file-based images)
      // bits 1-7: cf (7 bits, color format)
      // bits 8-19: w (12 bits, width)
      // bits 20-31: h (12 bits, height)

      const alwaysZeroBit = 0; // For file-based images, this bit is 0
      const colorFormat = LV_COLOR_FORMAT_RGB565; // Our chosen format
      const width = finalWidth;
      const height = finalHeight;

      // Construct the 32-bit header value
      // Ensure values fit within their bitfields (width/height up to 4095 pixels)
      const headerValue = (
          ((height & 0xFFF) << 20) | // 12 bits for height
          ((width & 0xFFF) << 8)  |  // 12 bits for width
          ((colorFormat & 0x7F) << 1) | // 7 bits for color format
          (alwaysZeroBit & 0x1)      // 1 bit for always_0b0
      );

      const lvglHeaderBuffer = Buffer.alloc(4);
      // Write the 32-bit header value in Little Endian format
      // This matches how ESP32 (and most microcontrollers) would read it.
      lvglHeaderBuffer.writeUInt32LE(headerValue, 0);

      // Concatenate the LVGL header and the RGB565 pixel data
      const finalImageBuffer = Buffer.concat([lvglHeaderBuffer, rgb565Buffer]);
      // --- END LVGL Header ---

      // 4. Store the processed RGB565 image (with header) in Firebase Cloud Storage
      const bucket = getStorage().bucket(); // Get the default storage bucket
      // Define the path within the bucket, using trackId and resolution for uniqueness
      const filePath = `album_art_rgb565/${trackId}_${ART_RESOLUTION}x${ART_RESOLUTION}.bin`;
      const file = bucket.file(filePath);

      await file.save(finalImageBuffer, { // Save the new buffer with the header
        metadata: {
          contentType: 'application/octet-stream', // Standard for raw binary data
          cacheControl: 'public, max-age=31536000', // Cache for 1 year (optional, but good practice)
          customMetadata: { // Store useful metadata
            width: finalWidth.toString(),
            height: finalHeight.toString(),
            format: 'RGB565',
            lvglHeaderAdded: 'true', // Indicate that LVGL header is present
            originalUrl: imageUrl // Keep a reference to the source URL
          }
        },
        resumable: false // For smaller files, direct upload might be faster
      });

      // 5. Get the public download URL for the stored image
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

      logger.log(`Successfully converted and uploaded RGB565 image with LVGL header to Cloud Storage: ${publicUrl}`);

      // 6. Store the public URL and other relevant metadata in Firestore
      const artUrlRef = db.collection("spotify_data")
        .doc("album_art_configs") // Fixed document ID to house the subcollection
        .collection("processed_album_art_urls")
        .doc(trackId)

      await artUrlRef.set({
        url: publicUrl,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(), // Timestamp of processing
        resolution: ART_RESOLUTION,
        format: 'RGB565',
        storagePath: filePath, // Path within Cloud Storage for internal reference
        width: finalWidth,
        height: finalHeight,
        lvglHeaderPresent: true // Indicate in Firestore as well
      }, { merge: true });

      logger.log(`Stored public URL in Firestore for track ${trackId}.`);

    } catch (error) {
      logger.error(`Failed to process album art for track ${trackId}.`, {
        errorMessage: error.message,
        errorStack: error.stack,
        errorResponseData: error.response?.data, // Include response data for axios errors
      });
    } finally {
      // 6. Clean up the command document to avoid re-triggering
      await docRef.delete();
      logger.log(`Cleaned up command document for ${docId}.`);
    }
});