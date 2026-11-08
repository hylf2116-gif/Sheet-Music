# Installing Audiveris for OMR

## What's missing

| Dependency | Status |
|---|---|
| Java 17+ | ❌ Not installed (`java -version` fails) |
| Audiveris CLI | ❌ Not installed |
| Homebrew | ❌ Not found |

---

## Install steps

### Step 1 — Java 17 or 21 (needs your approval to run)

**Option A: SDKMAN (no sudo, no Homebrew, recommended)**

```bash
# Installs SDKMAN into ~/.sdkman — no root needed
curl -s "https://get.sdkman.io" | bash
source "$HOME/.sdkman/bin/sdkman-init.sh"

# Install Eclipse Temurin 21 (Audiveris 5.3+ works with 17–21)
sdk install java 21.0.1-tem

# Verify
java -version   # should say openjdk version "21.x.x"
```

**Option B: Download from Adoptium directly**

Go to https://adoptium.net and download the macOS x64 `.pkg` for Java 21. This is a standard installer.

---

### Step 2 — Audiveris CLI JAR

Audiveris is not in Homebrew. The prebuilt CLI jar must be fetched from their GitHub releases.

```bash
# Download the latest release (5.3.1 as of late 2024)
mkdir -p ~/audiveris
curl -L -o ~/audiveris/audiveris-cli.jar \
  "https://github.com/Audiveris/audiveris/releases/download/5.3.1/audiveris-cli-5.3.1-all.jar"

# Verify it runs (should print usage)
java -jar ~/audiveris/audiveris-cli.jar -help
```

> **Note:** The exact jar filename changes between releases. If the above URL 404s, go to
> https://github.com/Audiveris/audiveris/releases and grab the `-all.jar` or `-cli.jar` asset.

---

### Step 3 — Run the OMR script

```bash
export AUDIVERIS_JAR="$HOME/audiveris/audiveris-cli.jar"

cd /Users/apple/sheet-music-platform
bash scripts/omr-test/run_omr.sh \
    backend/uploads/f87150a1-b23c-4658-8693-789c107cfa10.pdf \
    scripts/omr-test/output/bach-suite1

bash scripts/omr-test/run_omr.sh \
    backend/uploads/88c76a69-2e8e-4375-95fa-7d6397bf0b9d.pdf \
    scripts/omr-test/output/saint-saens-concerto

bash scripts/omr-test/run_omr.sh \
    backend/uploads/a4ae7460-f486-4a32-9ad2-50241b2a5c50.pdf \
    scripts/omr-test/output/popper-op76
```
