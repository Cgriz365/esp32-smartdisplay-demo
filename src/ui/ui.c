// This file was generated by SquareLine Studio
// SquareLine Studio version: SquareLine Studio 1.5.2
// LVGL version: 9.1.0
// Project name: spotify_api_v2

#include "ui.h"
#include "ui_helpers.h"

///////////////////// VARIABLES ////////////////////

// EVENTS
lv_obj_t * ui____initial_actions0;

// IMAGES AND IMAGE SETS

///////////////////// TEST LVGL SETTINGS ////////////////////
#if LV_COLOR_DEPTH != 16
    #error "LV_COLOR_DEPTH should be 16bit to match SquareLine Studio's settings"
#endif

///////////////////// ANIMATIONS ////////////////////

///////////////////// FUNCTIONS ////////////////////

///////////////////// SCREENS ////////////////////

void ui_init(void)
{
    lv_disp_t * dispp = lv_display_get_default();
    lv_theme_t * theme = lv_theme_default_init(dispp, lv_palette_main(LV_PALETTE_BLUE), lv_palette_main(LV_PALETTE_RED),
                                               true, LV_FONT_DEFAULT);
    lv_disp_set_theme(dispp, theme);
    ui_songScreen_screen_init();
    ui_albumScreen_screen_init();
    ui____initial_actions0 = lv_obj_create(NULL);
    lv_disp_load_scr(ui_songScreen);
}

void ui_destroy(void)
{
    ui_songScreen_screen_destroy();
    ui_albumScreen_screen_destroy();
}
