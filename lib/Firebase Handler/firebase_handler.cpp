#include "firebase_handler.h"
#include "addons/TokenHelper.h"
#include <Arduino.h>

static FirebaseHandler *instance = NULL;

FirebaseHandler::FirebaseHandler()
{
  instance = this;
}

void FirestoreTokenStatusCallback(TokenInfo info)
{
  Serial.printf("Token Info: type = %s, status = %s\n", getTokenType(info), getTokenStatus(info));
}

void FirebaseHandler::fcsDownloadCallback(FCS_DownloadStatusInfo info)
{
  if (info.status == firebase_fcs_download_status_init)
  {
    Serial.printf("Downloading file %s (%d) to %s\n", info.remoteFileName.c_str(), info.fileSize, info.localFileName.c_str());
  }
  else if (info.status == firebase_fcs_download_status_download)
  {
    Serial.printf("Downloaded %d%s, Elapsed time %d ms\n", (int)info.progress, "%", info.elapsedTime);
  }
  else if (info.status == firebase_fcs_download_status_complete)
  {
    Serial.println("Download completed\n");
  }
  else if (info.status == firebase_fcs_download_status_error)
  {
    Serial.printf("Download failed, %s\n", info.errorMsg.c_str());
  }
}

// Public method to get album art
String FirebaseHandler::getAlbumArt(const String &trackId)
{
  String documentPath = "album_art_rgb565/" + trackId + "_300x300.bin"; // Use trackId as document path
  String filename = trackId + ".bin";                                    // Use trackId as filename
  Serial.printf("Reading Firestore document: %s\n", documentPath.c_str());

  if (!Firebase.ready())
  {
    return "nullptr";
  }

  if (!Firebase.Storage.download(&this->fbdo, STORAGE_BUCKET, documentPath, filename, mem_storage_type_flash, fcsDownloadCallback))
  {
    Serial.printf("Error downloading file: %s\n", fbdo.errorReason().c_str());
    return "nullptr";
  }

  Serial.printf("File downloaded successfully: %s\n", filename.c_str());
  // Return the filename of the downloaded file
  // This can be used to read the file later


  return filename;
}

void FirebaseHandler::firebase_init()
{
  // Initialize Firebase
  config.api_key = API_KEY;
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;

  config.token_status_callback = FirestoreTokenStatusCallback;

  fbdo.setBSSLBufferSize(4096, 1024);

  fbdo.setResponseSize(2048);

  Firebase.reconnectNetwork(true);

  Firebase.begin(&config, &auth);
}

bool FirebaseHandler::wifi_init()
{
  bool connected = false;

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (!(WiFi.status() == WL_CONNECTED))
  {
    delay(1000);
  }

  firebase_init(); // Initialize Firebase after WiFi is connected
  connected = true;
  return connected;
}

bool FirebaseHandler::documentExists(const String &documentPath) // Check if a Firestore document exists
{
  if (WiFi.status() == WL_CONNECTED && Firebase.ready())
  {
    Serial.printf("Checking if document exists at path: %s\n", documentPath.c_str());
    String mask = "";
    return Firebase.Firestore.getDocument(&this->fbdo, FIREBASE_PROJECT_ID, "", documentPath.c_str(), mask.c_str());
  }
  else
    return false;
  Serial.println("Firebase not ready or WiFi not connected.");
}

void FirebaseHandler::firebase_loop()
{
  if (Firebase.ready())
  {
    Serial.println("Firebase is ready.");
  }
  else
  {
    Serial.println("Firebase is not ready.");
  }
}

bool FirebaseHandler::firestoreSet(String documentPath, FirebaseJson json) // Set Firestore configuration
{
  if (WiFi.status() == WL_CONNECTED && Firebase.ready())
  {
    Serial.printf("Document path: %s\n", documentPath.c_str());
    if (!(documentExists(documentPath)))
    {
      if (Firebase.Firestore.createDocument(&this->fbdo, FIREBASE_PROJECT_ID, "" /* databaseId can be (default) or empty */, documentPath.c_str(), json.raw()))
      {
        Serial.printf("ok\n%s\n\n", this->fbdo.payload().c_str());
        return true;
      }
      else
      {
        Serial.println(this->fbdo.errorReason());
        return false;
      }
    }

    else
    {
      if (Firebase.Firestore.patchDocument(&this->fbdo, FIREBASE_PROJECT_ID, "" /* databaseId can be (default) or empty */, documentPath.c_str(), json.raw(), ""))
      {
        Serial.printf("ok\n%s\n\n", this->fbdo.payload().c_str());
        return true;
      }
      else
      {
        Serial.println(this->fbdo.errorReason());
        return false;
      }
    }
  }

  return false;
}