pub(crate) fn info(source: &str, message: &str) {
    println!("[Rust][{}] {}", source, message);
}

pub(crate) fn warn(source: &str, message: &str) {
    eprintln!("[Rust][{}][warn] {}", source, message);
}

pub(crate) fn error(source: &str, message: &str) {
    eprintln!("[Rust][{}][error] {}", source, message);
}
