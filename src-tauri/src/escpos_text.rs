/// Best-effort plain-text extraction from an ESC/POS payload, for showing a
/// "what would have printed" preview in the settings UI. Not a faithful
/// renderer — it strips control sequences and emits printable ASCII + LF.
pub fn extract_text(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        match b {
            // ESC <cmd> [params]
            0x1B => {
                i += 1;
                if let Some(&cmd) = bytes.get(i) {
                    i += 1;
                    i += esc_param_len(cmd);
                }
            }
            // GS <cmd> [params]
            0x1D => {
                i += 1;
                if let Some(&cmd) = bytes.get(i) {
                    i += 1;
                    i += gs_param_len(cmd);
                }
            }
            // FS <cmd>
            0x1C => {
                i += 1;
                if i < bytes.len() {
                    i += 1;
                }
            }
            // LF
            0x0A => {
                out.push('\n');
                i += 1;
            }
            // CR — collapse with following LF if present, else newline
            0x0D => {
                if bytes.get(i + 1) == Some(&0x0A) {
                    out.push('\n');
                    i += 2;
                } else {
                    out.push('\n');
                    i += 1;
                }
            }
            // Tab
            0x09 => {
                out.push('\t');
                i += 1;
            }
            // Printable ASCII + UTF-8 continuation bytes
            0x20..=0x7E => {
                out.push(b as char);
                i += 1;
            }
            0x80..=0xFF => {
                // Best-effort UTF-8 passthrough — most receipts are ASCII but
                // Arabic / accented chars come through as multi-byte UTF-8.
                let utf8_len = utf8_char_len(b);
                if i + utf8_len <= bytes.len() {
                    if let Ok(s) = std::str::from_utf8(&bytes[i..i + utf8_len]) {
                        out.push_str(s);
                    }
                    i += utf8_len;
                } else {
                    i += 1;
                }
            }
            // Other control bytes — drop
            _ => {
                i += 1;
            }
        }
    }
    out
}

fn utf8_char_len(first: u8) -> usize {
    match first {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => 1,
    }
}

fn esc_param_len(cmd: u8) -> usize {
    match cmd {
        // ESC @ (init), ESC 2 (default line spacing) — no params
        0x40 | 0x32 => 0,
        // 1-byte param commands (most common): font, justify, emphasis,
        // double-strike, underline, line spacing, code page, character size,
        // print mode, color, etc.
        0x21 | 0x2D | 0x33 | 0x45 | 0x47 | 0x4D | 0x52 | 0x61 | 0x70 | 0x74
        | 0x76 | 0x77 | 0x7B => 1,
        // ESC d <n> (feed n lines), ESC J (feed dots), ESC e
        0x4A | 0x64 | 0x65 | 0x66 => 1,
        // ESC * <m> <nL> <nH> ... raster data (rare in receipts; assume 3)
        0x2A => 3,
        // ESC $ (abs h pos), ESC \ (rel h pos) — 2 param bytes
        0x24 | 0x5C => 2,
        // ESC ! — 1 byte
        _ => 1,
    }
}

fn gs_param_len(cmd: u8) -> usize {
    match cmd {
        // GS V <m> [n]   full cut commands
        0x56 => 2,
        // GS ! (size), GS B (white/black reverse), GS L (left margin),
        // GS W (print area width), GS h (barcode height), GS w (barcode width)
        0x21 | 0x42 | 0x4C | 0x57 | 0x68 | 0x77 => 1,
        // GS k — barcode print: variable length, skip rest until NUL or end
        0x6B => 2,
        _ => 1,
    }
}
