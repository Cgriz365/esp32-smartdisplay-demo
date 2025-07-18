#include <Arduino.h>
#include <esp32_smartdisplay.h>
#include <ui/ui.h>

#include <lvglDriver.h>
#include <firebase_handler.h>

FirebaseHandler firebase;

static TaskHandle_t lvgl_task_handle = NULL;
static TaskHandle_t firebase_task_handle = NULL;

void firebase_task(void *parameter)
{
  firebase.wifi_init();

  vTaskDelay(1500 / portTICK_PERIOD_MS);

  for (;;)
  {
    firebase.firebase_loop();
    vTaskDelay(5000 / portTICK_PERIOD_MS);
  }
}

void lvgl_task(void *parameter)
{
  smartdisplay_init();

  __attribute__((unused)) auto disp = lv_disp_get_default();
  lv_disp_set_rotation(disp, LV_DISP_ROTATION_0);

  init_lvgl_littlefs_driver();
  ui_init();

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
  
  xTaskCreatePinnedToCore(
      lvgl_task,     
      "LVGL_Task",      
      32000,           
      NULL,            
      5,                
      &lvgl_task_handle, 
      1                  
  );

  delay(15000); // Allow time for LVGL to initialize

  xTaskCreatePinnedToCore(
      firebase_task,   
      "firebase_task",    
      10240,       
      NULL,       
      1,                
      &firebase_task_handle, 
      0              
  );
}

void loop()
{
  vTaskDelay(1000 / portTICK_PERIOD_MS); 
}