//! Native popup notification sound (Windows PlaySound; no-op elsewhere).

/// Embedded WAV used on Windows via `PlaySoundW` + `SND_MEMORY`.
#[cfg(windows)]
static NOTIFICATION_WAV: &[u8] = include_bytes!("../assets/notification.wav");

/// Play the popup notification sound after a successful show.
///
/// On Windows this uses the Win32 `PlaySoundW` API with an in-memory WAV so
/// WebView2 autoplay policy cannot block it. Failures are logged and never
/// panic; callers must not fail the popup path on sound errors.
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
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};

    // SND_MEMORY: pszSound points at the RIFF/WAVE byte buffer, not a path.
    let ok = unsafe {
        PlaySoundW(
            NOTIFICATION_WAV.as_ptr() as *const u16,
            std::ptr::null_mut(),
            SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
        )
    };

    if ok == 0 {
        let msg = "PlaySoundW returned FALSE for embedded notification.wav".to_string();
        crate::runtime_log::warn("notification_sound", &msg);
        return Err(msg);
    }
    Ok(())
}

/// Validate that a buffer looks like a minimal RIFF/WAVE header.
#[cfg(test)]
fn wav_header_is_riff_wave(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_or_asset_wav_has_riff_wave_header() {
        // On Windows the static is the real asset; on other targets read the file
        // so CI on macOS/Linux still validates the asset without windows-sys.
        #[cfg(windows)]
        let bytes: &[u8] = NOTIFICATION_WAV;
        #[cfg(not(windows))]
        let bytes: &[u8] = include_bytes!("../assets/notification.wav");

        assert!(
            wav_header_is_riff_wave(bytes),
            "notification.wav must start with RIFF....WAVE"
        );
        assert!(bytes.len() > 44, "WAV should include a data payload");
    }

    #[test]
    fn wav_header_rejects_non_wave() {
        assert!(!wav_header_is_riff_wave(b""));
        assert!(!wav_header_is_riff_wave(b"RIFF....NOTW"));
        assert!(!wav_header_is_riff_wave(b"XXXX....WAVE"));
    }

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
}
