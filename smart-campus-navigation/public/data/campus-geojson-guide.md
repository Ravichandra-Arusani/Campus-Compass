# Campus Footprint Digitization Guide

Goal: produce a geospatially accurate `campus.geojson` aligned to satellite imagery.

1. Open `https://geojson.io`.
2. Switch to a satellite basemap.
3. Navigate to the campus and zoom to building level.
4. Draw polygons for each footprint using the polygon tool:
   - Nalanda Block
   - Girls Hostel
   - Boys Hostel
   - CIVIL / ECE / CSC block
   - Bottom academic strip
   - Parking boundary
5. For each polygon, set properties:
   - `name`: display label
   - `type`: one of `academic`, `hostel`, `service`, `ground`, `parking`
6. Export as GeoJSON and replace `public/data/campus.geojson`.

Notes:
- Coordinates in GeoJSON are `[lng, lat]`.
- Do not hand-edit coordinates unless you are correcting minor vertex mistakes.
- Keep polygons closed (first and last coordinate identical) for consistency.
