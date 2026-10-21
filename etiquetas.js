// Lectura de etiquetas de envío: códigos de barra / QR y texto impreso (OCR).
//
// Mercado Libre Flex: el QR trae solo el número de envío y el ID del vendedor, por ejemplo
//   {"id":"41234567890","sender_id":123456789,"hash_code":"...","security_digit":"0"}
// El nombre y la dirección del comprador vienen impresos, por eso se leen con OCR (Tesseract.js).
var Etiquetas = (function () {

  // Formatos que lee el escáner: QR y los códigos de barra habituales en etiquetas.
  // Son pocos a propósito: cada formato extra hace más lenta la lectura en celulares.
  function formatosEscaner() {
    if (!window.Html5QrcodeSupportedFormats) return undefined;
    var F = Html5QrcodeSupportedFormats;
    return [F.QR_CODE, F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.UPC_A, F.ITF, F.DATA_MATRIX];
  }

  // Se pasa al crear el lector: new Html5Qrcode(id, Etiquetas.configLector())
  function configLector() {
    return {
      formatsToSupport: formatosEscaner(),
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false
    };
  }

  // Se pasa al iniciar la cámara: lector.start(camara, Etiquetas.opcionesEscaner(), ...)
  // El QR de Mercado Libre es chico y denso: se pide la cámara en alta resolución y con
  // enfoque continuo (sin esto el navegador usa 640x480 y no alcanza a leerlo).
  // Recuadro ancho para que entren los códigos de barra largos.
  function opcionesEscaner() {
    return {
      fps: 10,
      qrbox: function (w, h) {
        var ancho = Math.floor(Math.min(w * 0.9, 520));
        return { width: Math.max(ancho, 120), height: Math.max(Math.floor(Math.min(h * 0.7, ancho * 0.8)), 100) };
      },
      videoConstraints: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [{ focusMode: "continuous" }]
      }
    };
  }

  // Enciende la cámara trasera. Si el celular no acepta la alta resolución, reintenta con la básica.
  function iniciarCamara(lector, alLeer) {
    var opciones = opcionesEscaner();
    return lector.start({ facingMode: "environment" }, opciones, alLeer, function () {}).catch(function (e) {
      delete opciones.videoConstraints;
      return lector.start({ facingMode: "environment" }, opciones, alLeer, function () {}).catch(function () { throw e; });
    });
  }

  // Plan B: leer el código desde una foto tomada con la cámara del celular
  // (más nítida que el video, funciona mejor con etiquetas arrugadas o con poca luz).
  var lectorFoto = null;
  function reducirImagen(archivo, maxLado) {
    return new Promise(function (ok) {
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        if (escala === 1) { ok(archivo); return; }
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { ok(b ? new File([b], "etiqueta.jpg", { type: "image/jpeg" }) : archivo); }, "image/jpeg", 0.92);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ok(archivo); };
      img.src = url;
    });
  }

  function leerCodigoDeFoto(archivo) {
    if (!window.Html5Qrcode) return Promise.reject(new Error("El lector aún está cargando, intenta de nuevo en un segundo."));
    var div = document.getElementById("lector-foto-oculto");
    if (!div) {
      div = document.createElement("div");
      div.id = "lector-foto-oculto";
      div.style.display = "none";
      document.body.appendChild(div);
    }
    if (!lectorFoto) lectorFoto = new Html5Qrcode("lector-foto-oculto", configLector());
    // Primero en tamaño reducido (rápido) y, si no se encuentra, con la foto original.
    return reducirImagen(archivo, 1600).then(function (f) {
      return lectorFoto.scanFile(f, false).catch(function () { return lectorFoto.scanFile(archivo, false); });
    }).catch(function () {
      throw new Error("No se encontró ningún código en la foto. Acércate a la etiqueta, con buena luz y sin reflejos.");
    });
  }

  function primero(obj, claves) {
    for (var i = 0; i < claves.length; i++) {
      var v = obj[claves[i]];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  }

  // Interpreta lo que leyó el escáner. Devuelve { codigo, origen, ml_sender_id, datos:{nombre,direccion,telefono,comuna} }
  function parsearCodigo(texto) {
    var t = String(texto || "").trim();
    var r = { codigo: t, origen: "codigo", ml_sender_id: "", datos: {} };
    if (!t) return r;

    if (t.charAt(0) === "{") {
      try {
        var o = JSON.parse(t);
        var id = primero(o, ["id", "shipment_id", "tracking", "tracking_number", "codigo", "code"]);
        if (id) r.codigo = id;
        r.ml_sender_id = primero(o, ["sender_id"]);
        r.origen = (o.sender_id !== undefined || o.hash_code !== undefined || o.security_digit !== undefined) ? "mercadolibre" : "json";
        // Etiquetas propias pueden traer los datos del cliente en el mismo QR.
        r.datos = {
          nombre: primero(o, ["nombre", "name", "cliente", "destinatario", "receiver_name"]),
          direccion: primero(o, ["direccion", "address", "domicilio", "address_line"]),
          comuna: primero(o, ["comuna", "city", "ciudad"]),
          telefono: normalizarTelefono(primero(o, ["telefono", "phone", "celular", "fono"]))
        };
        return r;
      } catch (e) { /* no era JSON: se usa el texto tal cual */ }
    }

    if (/^https?:\/\//i.test(t)) {
      try {
        var u = new URL(t), p = u.searchParams;
        var idUrl = p.get("id") || p.get("tracking") || p.get("shipment_id") || p.get("codigo") || p.get("code");
        if (idUrl) { r.codigo = idUrl.trim(); r.origen = "url"; }
      } catch (e) { /* URL inválida */ }
    }
    return r;
  }

  function normalizarTelefono(t) {
    var d = String(t || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 9 && d.charAt(0) === "9") return "56" + d;
    if (d.length === 8) return "569" + d;
    return d;
  }

  // --- OCR ---

  var cargandoOcr = null;
  function cargarOcr() {
    if (window.Tesseract) return Promise.resolve();
    if (!cargandoOcr) {
      cargandoOcr = new Promise(function (ok, falla) {
        var s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
        s.onload = ok;
        s.onerror = function () { cargandoOcr = null; falla(new Error("No se pudo cargar el lector de texto. Revisa tu conexión.")); };
        document.head.appendChild(s);
      });
    }
    return cargandoOcr;
  }

  function cargarImagen(archivo) {
    return new Promise(function (ok, falla) {
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); falla(new Error("No se pudo abrir la imagen.")); };
      img.src = url;
    });
  }

  // Escala de grises + más contraste: el texto de las etiquetas térmicas se lee bastante mejor.
  function prepararParaOcr(img) {
    var escala = Math.min(1, 1800 / Math.max(img.width, img.height));
    var c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var px = ctx.getImageData(0, 0, c.width, c.height), d = px.data;
    for (var i = 0; i < d.length; i += 4) {
      var g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(px, 0, 0);
    return c;
  }

  // progreso(0..1) es opcional. Devuelve el texto leído.
  function leerTexto(archivo, progreso) {
    return cargarOcr().then(function () { return cargarImagen(archivo); }).then(function (img) {
      return Tesseract.recognize(prepararParaOcr(img), "spa", {
        logger: function (m) { if (progreso && m.status === "recognizing text") progreso(m.progress); }
      });
    }).then(function (r) { return r.data.text || ""; });
  }

  var COMUNAS = ["Alhué", "Buin", "Calera de Tango", "Cerrillos", "Cerro Navia", "Colina", "Conchalí", "Curacaví", "El Bosque",
    "El Monte", "Estación Central", "Huechuraba", "Independencia", "Isla de Maipo", "La Cisterna", "La Florida", "La Granja",
    "La Pintana", "La Reina", "Lampa", "Las Condes", "Lo Barnechea", "Lo Espejo", "Lo Prado", "Macul", "Maipú", "María Pinto",
    "Melipilla", "Ñuñoa", "Padre Hurtado", "Paine", "Pedro Aguirre Cerda", "Peñaflor", "Peñalolén", "Pirque", "Providencia",
    "Pudahuel", "Puente Alto", "Quilicura", "Quinta Normal", "Recoleta", "Renca", "San Bernardo", "San Joaquín",
    "San José de Maipo", "San Miguel", "San Pedro", "San Ramón", "Santiago", "Talagante", "Tiltil", "Vitacura",
    "Viña del Mar", "Valparaíso", "Concepción", "Rancagua", "Temuco", "Antofagasta", "La Serena", "Coquimbo"];

  function sinAcentos(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

  function limpiar(s) { return String(s || "").replace(/\s+/g, " ").replace(/^[\s:;\-–|]+|[\s:;\-–|]+$/g, "").trim(); }

  // Busca nombre, dirección, comuna, referencia y teléfono en el texto de la etiqueta.
  function extraerDatos(texto) {
    var lineas = String(texto || "").split(/\r?\n/).map(limpiar).filter(function (l) { return l.length > 1; });
    var r = { nombre: "", direccion: "", comuna: "", referencia: "", telefono: "", envio: "" };

    lineas.forEach(function (l) {
      var m;
      if (!r.nombre && (m = l.match(/^(destinatario|nombre|recibe|cliente|para|comprador)\s*[:.\-]?\s+(.{3,})$/i))) r.nombre = limpiar(m[2]);
      else if (!r.direccion && (m = l.match(/^(direcci[oó]n|domicilio|calle|dir\.?)\s*[:.\-]?\s+(.{4,})$/i))) r.direccion = limpiar(m[2]);
      else if (!r.comuna && (m = l.match(/^(comuna|ciudad|localidad)\s*[:.\-]?\s+(.{3,})$/i))) r.comuna = limpiar(m[2]);
      else if (!r.referencia && (m = l.match(/^(referencia|ref\.?|indicaciones|observaci[oó]n(es)?)\s*[:.\-]?\s+(.{2,})$/i))) r.referencia = limpiar(m[3]);
      if (!r.envio && (m = l.match(/env[ií]o\s*(n[°ºo.]*)?\s*[:#]?\s*(\d{8,})/i))) r.envio = m[2];
      if (!r.telefono && (m = l.match(/(?:tel[eé]fono|tel\.?|cel(?:ular)?|fono|m[oó]vil)\s*[:.\-]?\s*(\+?[\d\s\-]{8,})/i))) r.telefono = normalizarTelefono(m[1]);
    });

    // Mercado Libre imprime el nombre así: "Juan Pérez (JUANPEREZ123)"
    if (!r.nombre) {
      lineas.some(function (l) {
        var m = l.match(/^([A-Za-zÁÉÍÓÚÑáéíóúñü' ]{4,60})\s*\(([A-Za-z0-9_.\-]{3,})\)$/);
        if (m) { r.nombre = limpiar(m[1]); return true; }
        return false;
      });
    }

    // Dirección: primera línea con tipo de calle y número.
    if (!r.direccion) {
      lineas.some(function (l) {
        if (/env[ií]o|venta|pack|c[oó]digo|sku|cantidad/i.test(l)) return false;
        if (/\b(av(da|enida)?\.?|calle|pasaje|psje\.?|pje\.?|camino|diagonal|gral\.?|general|los|las|el|la|san|santa)\b.*\d{1,5}/i.test(l)) {
          r.direccion = l; return true;
        }
        return false;
      });
    }

    if (!r.comuna) {
      var plano = sinAcentos(lineas.join(" "));
      var encontradas = COMUNAS.filter(function (c) { return new RegExp("\\b" + sinAcentos(c) + "\\b").test(plano); });
      // Si aparecen varias (ej. "Santiago" como región), se prefiere la más específica.
      encontradas.sort(function (a, b) { return (a === "Santiago") - (b === "Santiago") || b.length - a.length; });
      r.comuna = encontradas[0] || "";
    }

    if (!r.telefono) {
      var mt = lineas.join(" ").match(/(\+?56\s?)?9[\s\-]?\d{4}[\s\-]?\d{4}/);
      if (mt) r.telefono = normalizarTelefono(mt[0]);
    }
    return r;
  }

  // Dirección lista para el pedido: "Calle 123, Comuna" (sin repetir la comuna).
  function direccionCompleta(d) {
    var dir = d.direccion || "";
    if (d.comuna && sinAcentos(dir).indexOf(sinAcentos(d.comuna)) === -1) dir = dir ? dir + ", " + d.comuna : d.comuna;
    return dir;
  }

  return {
    configLector: configLector,
    opcionesEscaner: opcionesEscaner,
    leerCodigoDeFoto: leerCodigoDeFoto,
    iniciarCamara: iniciarCamara,
    parsearCodigo: parsearCodigo,
    normalizarTelefono: normalizarTelefono,
    leerTexto: leerTexto,
    extraerDatos: extraerDatos,
    direccionCompleta: direccionCompleta,
    sinAcentos: sinAcentos
  };
})();
