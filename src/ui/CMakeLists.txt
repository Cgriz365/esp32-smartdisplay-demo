SET(SOURCES ui_songScreen.c
    ui_albumScreen.c
    ui.c
    ui_comp_hook.c
    ui_helpers.c
    ui_img_1559207837.c
    ui_img_playing_png.c
    ui_img_home_png.c
    ui_img_library_png.c
    ui_img_albums_png.c
    ui_img_artist_png.c
    ui_img_playlist_png.c
    ui_img_settings_png.c
    ui_img_pause_png.c
    fonts/ui_font_Inter28Medium.c
    fonts/ui_font_Inter30Medium.c
    fonts/ui_font_inter16.c
    fonts/ui_font_inter162.c)

add_library(ui ${SOURCES})
