import express from "express"
import portfinder from "portfinder"
import { protocolless, uriPath, link } from "./src/utils.js"
import { initBackend } from "./src/backends.js"
import { serialize, contentTypes } from "./src/rdf.js"
import fs from "fs"

import config from "./src/config.js"
const { log, info, namespace } = config

const app = express()

// serve static files and EJS templates
app.use(namespace.pathname, express.static("public"))
app.set("views", "./views")
app.set("view engine", "ejs")

// serve message on root if mounted at a specific root path
if (namespace.pathname !== "/") {
  app.get("/", (req, res) => {
    res.render("root", config)
  })
}

// serve Vue application
const assetsDir = "dist/assets/"
const assets = fs.readdirSync(assetsDir)
if (assets.length) {
  log(`Serving Vue application from ${assetsDir} at ${namespace.pathname}`)
  const assetFiles = filter => ((req, res) => res.sendFile(assets.filter(filter)[0], { root: assetsDir }))
  app.get(`${namespace.pathname}client.js`, assetFiles(f => f.endsWith("js")))
  app.get(`${namespace.pathname}client.css`, assetFiles(f => f.endsWith("css")))
}

// server HTML view or info information
function serve(req, res, vars) {
  vars.source = vars.item?._source
  const options = { ...config, ...vars, link }

  if (req.query.format === "debug") {
    res.json(options)
  } else {
    res.render("index", options)
  }
}

// guess requested format from Accept-header
function requestFormat(req) {
  const formats = [
    [ "html", ["text/html", "application/xhtml+xml"] ],
    [ "jsonld", ["application/ld+json", "application/json"] ],
    [ "ntriples", ["application/n-triples", "text/plain"] ],
    [ "turtle", [ "text/turtle", "application/turtle", "application/x-turtle", "text/n3", "text/rdf+n3", "application/rdf+n3" ] ],
    [ "rdfxml", ["application/rdf+xml", "text/rdf"] ],
  ]

  for (let [format, types] of formats) {
    for (let type of types) {
      if (req.accepts(type)) {
        return format
      }
    }
  }
}

// serve JSKOS data
app.set("json spaces", 2)
console.log(namespace.pathname)
app.use(namespace.pathname, async (req, res) => {
  var uri

  if (req.query.uri) {
    // URI given by query parameter
    try {
      uri = new URL(req.query.uri)
    } catch {
      res.status(400)
      res.send("Invalid URI")
      return
    }
    const localUri = uriPath(uri, namespace)
    if (localUri != uri) {
      res.redirect(301, localUri)
      return
    }
  } else {
    // URI given by HTTP request
    // FIXME: /terminology/prizepapers_scripttype/46b61a9b-048f-4193-8894-25e7c00c8cd0
    // => http://uri.gbv.de/prizepapers_scripttype/46b61a9b-048f-4193-8894-25e7c00c8cd0
    // req.url == "/" => uri = namespace
    uri = new URL(req.url.substr(1), namespace) // namespace.href?
    uri.search = ""
  }

  info(`get ${uri}`)

  const format = req.query.format || requestFormat(req) || "jsonld"
  if (!format.match(/^(html|debug|json|jsonld|jskos)$/) && !contentTypes[format]) {
    res.status(400)
    res.send(`Serialization format ${format} not supported!`)
    return
  }

  if (protocolless(uri) === protocolless(namespace)) {
    // TODO: configure whether to serve index item
    serve(req, res, { })
    return
  }

  const backend = app.get("backend")
  // TODO catch error and send 5xx error in case
  const item = await backend.getItem(`${uri}`)
  res.status(item ? 200 : 404)

  info((item ? "got " : "missing ") + uri)

  if (format === "html" || format === "debug") {
    // serve HTML
    serve(req, res, { uri: `${uri}`, item })
  } else {
    // serialize RDF
    const contentType = contentTypes[format]
    if (contentType && contentType != "application/json") {
      res.set("Content-Type", contentType)
      res.send(await serialize(item, contentType))
    } else {
      res.json(item)
    }
  }
})

// start the proxy server
const start = async () => {
  if (config.env == "test") {
    portfinder.basePort = config.port
    config.port = await portfinder.getPortPromise()
  }

  const backend = await initBackend(config)
  app.set("backend", backend)

  if (config.index) {
    app.set("index", await initBackend({...config, backend: config.index}))
  }

  app.listen(config.port, () => {
    log(`JSKOS proxy ${namespace} from ${backend} at http://localhost:${config.port}/`)
  })
}

start()

export { app }
