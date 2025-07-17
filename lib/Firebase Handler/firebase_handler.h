#ifndef FIREBASE_HANDLER_H
#define FIREBASE_HANDLER_H

#include <Arduino.h>
#include <Firebase_ESP_Client.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "secrets.h" // Include your secrets file for WiFi credentials

#define FIRESTORE_ART_URL_COLLECTION "spotify_data/album_art_configs/processed_album_art_urls"
#define STORAGE_BUCKET "spotify-api-database.firebasestorage.app" // Replace with your Firebase Storage bucket name

class FirebaseHandler
{
private:
    FirebaseData fbdo;
    FirebaseConfig config;
    FirebaseAuth auth;

    const int IMAGE_WIDTH = 300;
    const int IMAGE_HEIGHT = 300;
    const int IMAGE_SIZE_BYTES = IMAGE_WIDTH * IMAGE_HEIGHT * 2; // 180000 bytes

    static void fcsDownloadCallback(FCS_DownloadStatusInfo info);
    void firebase_init();                                     // Initialize Firebase with configuration
    friend void FirestoreTokenStatusCallback(TokenInfo info); // Callback for token status updates

public:
    FirebaseHandler();                                         // Constructor to initialize FirebaseHandler instance
    bool wifi_init();                                          // Initialize WiFi connection
    bool documentExists(const String &documentPath);           // Check if a Firestore document exists
    bool firestoreSet(String documentPath, FirebaseJson json); // Set Firestore configuration
    void firebase_loop();
    String getAlbumArt(const String& trackId);
    
};

#endif // FIREBASE_HANDLER_H
