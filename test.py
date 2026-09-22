from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="mobiuslabsgmbh/faster-whisper-large-v3-turbo",
    local_dir=r"D:\PROGETTI\SMI\backend\models\faster-whisper-large-v3-turbo"
)