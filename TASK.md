# Spine Preview Automation Pipeline

## Original Task
Replace client-side MediaRecorder webm capture with a fully automatic GitHub Actions pipeline:
- User uploads files → page created immediately with placeholder
- Background workflow renders animation in headless Chrome
- Writes full-length webm back to the library entry

## Key Requirements
- No client-side waiting for video capture
- Page URL created immediately after upload
- User can close page at any point — animation 100% saved
- Capture uses Playwright recordVideo (replaced broken captureStream+MediaRecorder)
- Workflow runs on repository_dispatch with event type spine-export-webm
- Matrix strategy: discover → export (parallel) → finalize
- Files >4 MB split into 3.5 MB base64 chunks
- AtlasAttachmentLoader patched to tolerate missing regions
- SHA race condition fix with retry logic in putGitHubContent
- Viewer error handler for Region not set errors
