# RLV — Reciprocal Lattice Viewer

A web replacement for the DIALS reciprocal lattice viewer.

**[Open the viewer](https://mpks.github.io/rlv/)** · [Theory](https://github.com/mpks/rlv/wiki)

## Loading files

- Drag a `.expt` and a `.refl` file onto the view, or click **Open**.
- Or name them in the page address, and they are downloaded and loaded on start-up:

  ```
  index.html?expt=<url>&refl=<url>
  ```

  URLs can be relative to the page (`?expt=refined.expt&refl=refined.refl`) or absolute.
  Files on a different server than the page load only if that server allows
  cross-origin access (sends an `Access-Control-Allow-Origin` header).

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
