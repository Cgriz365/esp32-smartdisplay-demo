#include <Arduino.h>
#include <esp32_smartdisplay.h>
#include <ui/ui.h>
#include <lvglDriver.h>

#include <firebase_handler.h>
#define DEBUG 1

FirebaseHandler firebase;

static const char *TAG = "APP_MAIN";

static TaskHandle_t lvgl_task_handle = NULL;
static TaskHandle_t firebase_task_handle = NULL;

// Declare a binary semaphore
static SemaphoreHandle_t display_init_semaphore;

void firebase_task(void *parameter)
{ // Initialize the FirebaseHandler
  // Wait indefinitely until the display initialization is complete
  if (xSemaphoreTake(display_init_semaphore, portMAX_DELAY) != pdTRUE)
  {
    ESP_LOGE(TAG, "Failed to take display init semaphore in lvgl_task");
    // Handle error or restart task/system as appropriate
    vTaskDelete(NULL); // Delete this task if it can't proceed
  }
  ESP_LOGI(TAG, "LVGL task started after display init.");

  firebase.wifi_init();

  FirebaseJson content;

  content.set("fields/playlist/booleanValue", true);

  // FirebaseJson albumContent;

  // String docId = "4aawyAB9vmqN6y0c6n7koi";

  // String albumDocPath = "process_album_art/" + docId;

  // albumContent.set("fields/imageUrl/stringValue", "https://i.scdn.co/image/ab67616d00001e022c5b24ecfa39523a75c993c4");
  // albumContent.set("fields/trackId/stringValue", "4aawyAB9vmqN6y0c6n7koi");

  firebase.firestoreSet("commands/fetch_saved_playlists", content);
  // vTaskDelay(1500 / portTICK_PERIOD_MS);
  // firebase.firestoreSet(albumDocPath.c_str(), albumContent);
  vTaskDelay(1500 / portTICK_PERIOD_MS);

  // smartdisplay_lcd_set_backlight(0); // Set backlight to 50%
  // firebase.getAlbumArt("4aawyAB9vmqN6y0c6n7koi");
  // smartdisplay_lcd_set_backlight(1); // Set backlight to 50%

  for (;;)
  {
    firebase.firebase_loop();
    // Delay to prevent flooding the Firebase server with requests
    // Adjust the delay as needed for your application
    vTaskDelay(5000 / portTICK_PERIOD_MS);
  }
}

void lvgl_task(void *parameter)
{
  ulong next_millis;
  auto lv_last_tick = millis();

  for (;;)
  {
    auto const now = millis();

    lv_tick_inc(now - lv_last_tick);
    lv_last_tick = now;

    lv_timer_handler();
    vTaskDelay(5 / portTICK_PERIOD_MS);
  }
}

void setup()
{
  Serial.begin(115200);

  while (!Serial)
  {
    delay(100);
  }

  display_init_semaphore = xSemaphoreCreateBinary();
  if (display_init_semaphore == NULL)
  {
    ESP_LOGE(TAG, "Failed to create display init semaphore");
    while (1)
    {
      vTaskDelay(1);
    }
  }

  smartdisplay_init();

  xSemaphoreGive(display_init_semaphore);

  __attribute__((unused)) auto disp = lv_disp_get_default();
  lv_disp_set_rotation(disp, LV_DISP_ROTATION_0);

  init_lvgl_littlefs_driver();

  delay(5000); // Wait for the display to stabilize
  ui_init();
  
  xTaskCreatePinnedToCore(
      lvgl_task,         // Function that should be called
      "LVGL_Task",       // Name of the task (for debugging)
      32000,             // Stack size (bytes)
      NULL,              // Parameter to pass
      5,                 // Task priority
      &lvgl_task_handle, // Task handle
      1                  // Core ID (0 for core 0, 1 for core 1)
  );

  if (lvgl_task_handle == NULL)
  {
    ESP_LOGE(TAG, "Failed to create LVGL task");
    while (1)
    {
      vTaskDelay(1);
    }
  }

  xTaskCreatePinnedToCore(
      firebase_task,         // Function that should be called
      "firebase_task",       // Name of the task (for debugging)
      10240,                 // Stack size (bytes)
      NULL,                  // Parameter to pass
      1,                     // Task priority
      &firebase_task_handle, // Task handle
      0                      // Core ID (0 for core 0, 1 for core 1)
  );

  if (firebase_task_handle == NULL)
  {
    ESP_LOGE(TAG, "Failed to create LVGL task");
    while (1)
    {
      vTaskDelay(1);
    }
  }
}

void loop()
{
  vTaskDelay(1000 / portTICK_PERIOD_MS); // Prevent watchdog timeout
}