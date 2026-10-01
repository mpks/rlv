# RLV — Reciprocal Lattice Viewer

A web replacement for the DIALS reciprocal lattice viewer.

**[Open the viewer](https://mpks.github.io/rlv/)** · [Theory](https://github.com/mpks/rlv/wiki)

## Loading files

- Drag a `.expt` and a `.refl` file onto the view, or click **Open**.
- Or name them in the page address, and they are downloaded and loaded on start-up:

  ```
  index.html?expt=<url>&refl=<url>
  ```

  Repeat the pair to load several datasets (the first replaces, the rest are added):
  `?expt=a.expt&refl=a.refl&expt=b.expt&refl=b.refl`.
  URLs can be relative to the page (`?expt=refined.expt&refl=refined.refl`) or absolute.
  Files on a different server than the page load only if that server allows
  cross-origin access (sends an `Access-Control-Allow-Origin` header).

### From the command line (local or remote machine)

`dials_rlv.py` (repo root, Python standard library only) serves the viewer and
your files and opens them in the browser:

```bash
python3 dials_rlv.py indexed.expt indexed.refl
python3 dials_rlv.py a.expt a.refl b.expt b.refl     # several datasets
```

Over SSH it prints an `ssh -L …` command to run on your own computer and a link
to open there, so the viewer runs locally and only the data travels over SSH.

### Trying it locally

Serve the viewer and the data from one directory:

```bash
cp rlv_html/dist/index.html /path/to/data/
cd /path/to/data
python3 -m http.server 8000
# open http://localhost:8000/index.html?expt=refined.expt&refl=refined.refl
```

Or use the online viewer with local files, via a server that sends the CORS header:

```bash
cd /path/to/data
python3 /path/to/rlv/rlv_html/scripts/serve_cors.py 8000
# open https://mpks.github.io/rlv/?expt=http://localhost:8000/refined.expt&refl=http://localhost:8000/refined.refl
```

## Licence

BSD 3-Clause, © Science and Technology Facilities Council. See [LICENSE](LICENSE).
