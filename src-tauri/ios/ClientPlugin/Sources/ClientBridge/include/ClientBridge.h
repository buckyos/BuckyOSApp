// The Rust side (`content/mobile/ios.rs`): calls that do not go through Tauri. On the main thread;
// none of them waits.

#pragma once

#include <stdbool.h>
#include <stdint.h>

/// What happened to the views, the app, the player, the recorder.
void bucky_on_event(const char *json);

/// Whether a view may go to an address; Rust takes it from there when it may not.
bool bucky_on_navigate(const char *view, const char *url, bool main_frame, bool new_window);

/// A call of a page; answered by the plugin's `reply`.
void bucky_on_call(const char *view, const char *origin, bool main_frame, const char *message, int64_t reply_id);
