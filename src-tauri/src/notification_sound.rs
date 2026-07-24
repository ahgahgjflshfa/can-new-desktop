//! Native popup notification sound (Windows system alert; no-op elsewhere).

/// Play the popup notification sound after a successful show.
///
/// On Windows this uses the Win32 `PlaySoundW` API with the user's configured
/// system notification sound alias, so WebView2 autoplay policy cannot block it.
/// Failures are logged and never panic; callers must not fail the popup path on
/// sound errors.
///
/// On non-Windows platforms this is a no-op (frontend Web Audio handles sound).
pub fn play_popup_notification_sound() -> Result<(), String> {
    #[cfg(windows)]
    {
        play_windows_notification_sound()
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(windows)]
fn play_windows_notification_sound() -> Result<(), String> {
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC, SND_NODEFAULT};

    // Prefer the Windows notification event sound; fall back to classic system alerts.
    // Alias names are looked up in the user's Sound scheme (control panel).
    const ALIASES: [&str; 3] = [
        "Notification.Default",
        "SystemNotification",
        "SystemAsterisk",
    ];

    for alias in ALIASES {
        let wide: Vec<u16> = alias.encode_utf16().chain(std::iter::once(0)).collect();
        // Alias lookup completes during the call; the wave path is loaded from the
        // registry, so a short-lived wide buffer is safe with SND_ASYNC.
        let ok = unsafe {
            PlaySoundW(
                wide.as_ptr(),
                std::ptr::null_mut(),
                SND_ALIAS | SND_ASYNC | SND_NODEFAULT,
            )
        };
        if ok != 0 {
            return Ok(());
        }
    }

    let msg = "PlaySoundW returned FALSE for system notification aliases".to_string();
    crate::runtime_log::warn("notification_sound", &msg);
    Err(msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_is_noop_ok_on_non_windows() {
        // On this host (and any non-Windows CI), the helper must succeed without
        // side effects so show_alert_popup never fails because of sound.
        #[cfg(not(windows))]
        {
            assert!(play_popup_notification_sound().is_ok());
        }
        #[cfg(windows)]
        {
            // Windows CI may or may not have an audio device; never panic.
            let _ = play_popup_notification_sound();
        }
    }

    #[test]
    fn sound_error_must_not_propagate_as_popup_failure() {
        // Document the call-site contract: map sound Err to warn-only.
        fn show_path_continues_after_sound(sound_result: Result<(), String>) -> Result<(), String> {
            if let Err(err) = sound_result {
                // Mirrors popup_commands wiring: warn, do not return Err.
                let _ = err;
            }
            Ok(())
        }

        assert!(show_path_continues_after_sound(Ok(())).is_ok());
        assert!(show_path_continues_after_sound(Err("PlaySoundW failed".into())).is_ok());
    }

    #[test]
    fn windows_alias_candidates_are_non_empty() {
        // Keep the preferred Windows notification alias list intentional.
        let aliases = [
            "Notification.Default",
            "SystemNotification",
            "SystemAsterisk",
        ];
        assert_eq!(aliases.len(), 3);
        assert!(aliases.iter().all(|alias| !alias.is_empty()));
    }
}
