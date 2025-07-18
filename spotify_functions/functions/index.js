const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https"); // <-- ADD HttpsError HERE!
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { getStorage } = require('firebase-admin/storage');
const logger = require("firebase-functions/logger");

const admin = require("firebase-admin");
const axios = require("axios");
const sharp = require('sharp');

// --- Initialization ---
admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: "us-central1" });

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
      logger.warn("Spotify API credentials not found in Firestore. Please set them up in app_config/spotify_api.");
      spotifyClientId = null; // Ensure variables are cleared
      spotifyClientSecret = null;
    }
  } catch (error) {
    logger.error("Error loading Spotify API credentials from Firestore during global initialization:", error);
    spotifyClientId = null;
    spotifyClientSecret = null;
  }
}

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
      spotifyClientId = clientId;
      spotifyClientSecret = clientSecret;
      res.status(200).send('Spotify credentials saved successfully!');
    } catch (error) {
      logger.error("Error saving Spotify credentials:", error);
      res.status(500).send('Failed to save Spotify credentials.');
    }
  });

exports.spotifyLogin = onRequest({ cors: true }, async (req, res) => {
  await loadSpotifyCredentials();

  if (!spotifyClientId) {
    res.status(500).send('Spotify Client ID is not set. Please configure it first.');
    return;
  }

  const authUrl =
    "https://accounts.spotify.com/authorize?" + 
    new URLSearchParams({
      response_type: "code",
      client_id: spotifyClientId,
      scope: SPOTIFY_SCOPES,
      redirect_uri: REDIRECT_URI,
    }).toString();

  res.redirect(authUrl);
});

exports.spotifyCallback = onRequest(async (req, res) => {
  await loadSpotifyCredentials(); 

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
      url: "https://accounts.spotify.com/api/token",
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

async function getValidAccessToken() {
  await loadSpotifyCredentials(); 

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
        url: 'https://accounts.spotify.com/api/token',
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

exports.fetchPlaylists = onDocumentWritten("commands/fetch_saved_playlists", async (event) => {
  if (!event.data.after.exists) {
    return;
  }

  logger.log("`fetchPlaylists` command received. Fetching from Spotify...");

  try {
    const accessToken = await getValidAccessToken();
    const response = await axios.get("https://api.spotify.com/v1/me/playlists", { 
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
    await event.data.after.ref.delete();

  } catch (error) {
    logger.error("Error fetching playlists:", error.response?.data || error.message);
  }
});