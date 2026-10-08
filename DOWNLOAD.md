# Download RLV

RLV runs in any modern web browser, with nothing to install:
**[open the web version](https://mpks.github.io/rlv/)**.

The desktop app is the same viewer in its own window, with native file dialogs
and drag-and-drop from your file manager.

## Linux

Pick one of the three formats. All are built from the same code.

| Format | Best for | Download |
|---|---|---|
| `.deb` | Ubuntu, Debian, Linux Mint | [RLV-linux-amd64.deb](../../releases/latest/download/RLV-linux-amd64.deb) |
| `.rpm` | Fedora, RHEL, Rocky, openSUSE | [RLV-linux-x86_64.rpm](../../releases/latest/download/RLV-linux-x86_64.rpm) |
| AppImage | Any distribution, or no admin rights | [RLV-linux-x86_64.AppImage](../../releases/latest/download/RLV-linux-x86_64.AppImage) |

### Ubuntu / Debian (`.deb`)

Double-click the downloaded file to install it with the App Center, or in a terminal:

```bash
sudo apt install ./RLV-linux-amd64.deb
```

Then start **RLV** from the applications menu, or run `rlv` in a terminal.
To remove it: `sudo apt remove rlv`.

### Fedora / RHEL (`.rpm`)

```bash
sudo dnf install ./RLV-linux-x86_64.rpm
```

### AppImage (any distribution, no installation)

```bash
chmod +x RLV-linux-x86_64.AppImage
./RLV-linux-x86_64.AppImage
```

You can rename the file (for example to `rlv`) and move it to `~/.local/bin`.
On Ubuntu 22.04 and later, AppImages need the FUSE 2 library:
`sudo apt install libfuse2`.

## macOS and Windows

Not available yet. Use the [web version](https://mpks.github.io/rlv/) in the
meantime.

## Older versions

All releases, with their release notes, are on the [Releases](../../releases) page.
