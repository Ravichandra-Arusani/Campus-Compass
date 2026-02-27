const fs = require("fs")
const path = require("path")

const projectRoot = path.resolve(__dirname, "..")
const campusGeoJsonPath = path.join(projectRoot, "public", "data", "Campus map.geojson")
const roadsGeoJsonPath = path.join(projectRoot, "public", "data", "Roads.geojson")
const templatePath = path.join(__dirname, "templates", "standalone-campus-navigation.template.html")

const outputPaths = [
  path.join(projectRoot, "campus-navigation.html"),
  path.join("C:", "Users", "A.Ravi chandra", "Downloads", "campus-navigation.html"),
]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function writeStandaloneHtml() {
  const campusGeoJson = readJson(campusGeoJsonPath)
  const roadsGeoJson = readJson(roadsGeoJsonPath)
  const template = fs.readFileSync(templatePath, "utf8")

  const html = template
    .replace("__CAMPUS_JSON__", JSON.stringify(campusGeoJson))
    .replace("__ROADS_JSON__", JSON.stringify(roadsGeoJson))

  outputPaths.forEach((targetPath) => {
    fs.writeFileSync(targetPath, html, "utf8")
    console.log(`Generated: ${targetPath}`)
  })
}

writeStandaloneHtml()
