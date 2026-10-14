#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args_os().skip(1);
    match args.next().as_deref() {
        Some(value) if value == "--build-info" => {
            let result = match (args.next(), args.next()) {
                (Some(path), None) => {
                    amorist_lib::build_info::write_new(std::path::Path::new(&path))
                }
                _ => Err("Usage: amorist --build-info <new-output.json>".into()),
            };
            if let Err(error) = result {
                eprintln!("{error}");
                std::process::exit(1);
            }
            return;
        }
        Some(value) if value == "--version" && args.next().is_none() => {
            println!("amorist {}", amorist_lib::build_info::current().version);
            return;
        }
        _ => {}
    }
    amorist_lib::run()
}
