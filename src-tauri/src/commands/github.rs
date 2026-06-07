use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub async fn github_list_yaml_files(dir: String) -> Result<Vec<FileEntry>, String> {
    let path = PathBuf::from(&dir);
    let mut files = Vec::new();

    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("yaml") {
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
            files.push(FileEntry { name, content });
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn github_write_yaml_file(
    dir: String,
    name: String,
    content: String,
) -> Result<(), String> {
    let path = PathBuf::from(&dir).join(&name);
    fs::write(&path, content).map_err(|e| e.to_string())
}
