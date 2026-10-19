// Funciones compartidas del seguimiento en vivo (panel admin, repartidor, cliente y página web).
//
// Colecciones públicas de solo lectura (se leen por enlace o código, nunca se listan):
//   seguimiento/{token}  -> estado, historial, ubicación del repartidor y destino del pedido
//   codigos/{codigo}     -> { tracking_id } para buscar un pedido por su código en la página web
// El token es aleatorio y largo, así que el enlace no se puede adivinar.
var Seguimiento = (function () {
  var ESTADOS = {
    pendiente: "Pendiente",
    en_camino: "En camino",
    entregado: "Entregado",
    no_entregado: "No entregado",
    devuelto: "Devuelto"
  };

  function generarToken() {
    var letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    var azar = new Uint32Array(20);
    crypto.getRandomValues(azar);
    var t = "";
    for (var i = 0; i < azar.length; i++) t += letras[azar[i] % letras.length];
    return t;
  }

  // Los ID de Firestore no admiten "/", y en la web el código se escribe en mayúsculas.
  function idCodigo(codigo) {
    return String(codigo || "").trim().toUpperCase().replace(/\//g, "_");
  }

  // Al cliente solo se le muestra el primer nombre (suyo y del repartidor).
  function primerNombre(n) {
    return String(n || "").trim().split(/\s+/)[0] || "";
  }

  function url(token) {
    return new URL("seguimiento.html?id=" + encodeURIComponent(token), location.href).href;
  }

  // Crea o actualiza la ficha pública del pedido y devuelve su token.
  // opciones.estadoAnterior: para registrar el cambio en el historial solo si cambió.
  // opciones.codigoAnterior: si el admin cambió el código, se mueve la búsqueda por código.
  function sincronizar(db, pedidoId, p, opciones) {
    opciones = opciones || {};
    var FV = firebase.firestore.FieldValue;
    var nuevo = !p.tracking_id;
    var token = p.tracking_id || generarToken();
    var estado = p.estado || "pendiente";
    var codigo = p.codigo_barra || pedidoId;
    var enCamino = estado === "en_camino";

    var datos = {
      pedido_id: pedidoId,
      codigo: codigo,
      estado: estado,
      cliente_nombre: primerNombre(p.cliente_nombre),
      repartidor_id: p.repartidor_id || null,
      repartidor_nombre: primerNombre(p.repartidor_nombre),
      compartiendo: enCamino,
      actualizado: FV.serverTimestamp()
    };
    // La ubicación del repartidor solo es visible mientras el pedido va en camino.
    if (!enCamino) datos.ubicacion = null;
    // destino null = la dirección cambió y hay que volver a ubicarla en el mapa.
    if (p.destino !== undefined) datos.destino = p.destino || null;
    if (nuevo || opciones.estadoAnterior !== estado) {
      datos.historial = FV.arrayUnion({ estado: estado, fecha: firebase.firestore.Timestamp.now() });
    }
    // Datos visibles para el cliente: quién recibió o por qué no se entregó.
    if (estado === "entregado" && p.entrega) {
      datos.entrega = {
        recibe: primerNombre(p.entrega.recibe_nombre),
        relacion: p.entrega.relacion || "",
        con_foto: !!p.entrega.con_foto,
        con_firma: !!p.entrega.con_firma
      };
    }
    if (estado === "no_entregado" && p.no_entrega) datos.no_entrega = { motivo: p.no_entrega.motivo || "" };
    if (estado !== "entregado") datos.entrega = null;
    if (estado !== "no_entregado") datos.no_entrega = null;
    // Entrega reprogramada: el cliente ve la nueva fecha.
    datos.programado_para = estado === "pendiente" && p.fecha_programada ? p.fecha_programada : null;

    var batch = db.batch();
    batch.set(db.collection("seguimiento").doc(token), datos, { merge: true });
    if (nuevo) batch.update(db.collection("Pedidos").doc(pedidoId), { tracking_id: token });

    var envio = batch.commit().then(function () {
      p.tracking_id = token;
      var cod = idCodigo(codigo);
      var anterior = opciones.codigoAnterior ? idCodigo(opciones.codigoAnterior) : null;
      if (!nuevo && (!anterior || anterior === cod)) return token;
      // El índice por código va aparte: si falla, el cambio de estado ya quedó guardado.
      var pasos = [db.collection("codigos").doc(cod).set({ tracking_id: token })];
      if (anterior && anterior !== cod) pasos.push(db.collection("codigos").doc(anterior).delete());
      return Promise.all(pasos).catch(function (e) {
        console.warn("No se pudo indexar el código de seguimiento:", e);
      }).then(function () { return token; });
    });
    // Sin señal, Firestore guarda el cambio en el celular y lo envía después;
    // con noEsperar no se bloquea la pantalla esperando al servidor.
    p.tracking_id = token;
    return opciones.noEsperar ? sinEsperar(envio, token) : envio;
  }

  // Devuelve lo antes posible: si el servidor no responde en 1,5 s se sigue con el cambio
  // ya guardado en el celular. Los errores posteriores se registran en la consola.
  function sinEsperar(promesa, valor) {
    promesa.catch(function (e) { console.warn("Cambio pendiente no se pudo enviar:", e); });
    return Promise.race([promesa, new Promise(function (ok) { setTimeout(function () { ok(valor); }, 1500); })]);
  }

  function eliminar(db, p) {
    if (!p.tracking_id) return Promise.resolve();
    var batch = db.batch();
    batch.delete(db.collection("seguimiento").doc(p.tracking_id));
    batch.delete(db.collection("evidencias").doc(p.tracking_id));
    if (p.codigo_barra) batch.delete(db.collection("codigos").doc(idCodigo(p.codigo_barra)));
    return batch.commit();
  }

  function publicarUbicacion(db, tokens, pos) {
    var batch = db.batch();
    tokens.forEach(function (t) {
      batch.update(db.collection("seguimiento").doc(t), {
        ubicacion: { lat: pos.lat, lng: pos.lng, precision: Math.round(pos.precision || 0) },
        ubicacion_fecha: firebase.firestore.FieldValue.serverTimestamp(),
        compartiendo: true
      });
    });
    return batch.commit();
  }

  function buscarPorCodigo(db, codigo) {
    var id = idCodigo(codigo);
    if (!id) return Promise.resolve(null);
    return db.collection("codigos").doc(id).get().then(function (d) {
      return d.exists && d.data().tracking_id ? d.data().tracking_id : null;
    });
  }

  // --- Mapas (OpenStreetMap: gratis, sin clave) ---

  function geocodificar(direccion) {
    var q = String(direccion || "").trim();
    if (!q) return Promise.resolve(null);
    if (!/chile/i.test(q)) q += ", Chile";
    return fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cl&q=" + encodeURIComponent(q), {
      headers: { "Accept-Language": "es" }
    }).then(function (r) { return r.json(); }).then(function (a) {
      return a && a[0] ? { lat: Number(a[0].lat), lng: Number(a[0].lon) } : null;
    }).catch(function () { return null; });
  }

  function ruta(desde, hasta) {
    return fetch("https://router.project-osrm.org/route/v1/driving/" +
      desde.lng + "," + desde.lat + ";" + hasta.lng + "," + hasta.lat +
      "?overview=full&geometries=geojson"
    ).then(function (r) { return r.json(); }).then(function (d) {
      var r0 = d && d.routes && d.routes[0];
      if (!r0) return null;
      return {
        puntos: r0.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
        metros: r0.distance,
        segundos: r0.duration
      };
    }).catch(function () { return null; });
  }

  function distanciaMetros(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function textoDistancia(m) {
    return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km";
  }

  function textoMinutos(s) {
    var min = Math.max(1, Math.round(s / 60));
    return min < 60 ? min + " min" : Math.floor(min / 60) + " h " + (min % 60) + " min";
  }

  function urlGoogleMaps(direccion) {
    return "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + encodeURIComponent(direccion || "");
  }

  function urlWaze(direccion, destino) {
    return destino
      ? "https://waze.com/ul?ll=" + destino.lat + "," + destino.lng + "&navigate=yes"
      : "https://waze.com/ul?q=" + encodeURIComponent(direccion || "") + "&navigate=yes";
  }

  // Ícono redondo con emoji para los marcadores de Leaflet.
  function iconoMapa(emoji, color) {
    return L.divIcon({
      className: "",
      html: "<div style='width:40px;height:40px;border-radius:50%;background:" + color +
        ";border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 12px rgba(0,0,0,.4)'>" +
        emoji + "</div>",
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
  }

  function capaBase(mapa) {
    return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>"
    }).addTo(mapa);
  }

  return {
    ESTADOS: ESTADOS,
    idCodigo: idCodigo,
    primerNombre: primerNombre,
    url: url,
    sincronizar: sincronizar,
    sinEsperar: sinEsperar,
    eliminar: eliminar,
    publicarUbicacion: publicarUbicacion,
    buscarPorCodigo: buscarPorCodigo,
    geocodificar: geocodificar,
    ruta: ruta,
    distanciaMetros: distanciaMetros,
    textoDistancia: textoDistancia,
    textoMinutos: textoMinutos,
    urlGoogleMaps: urlGoogleMaps,
    urlWaze: urlWaze,
    iconoMapa: iconoMapa,
    capaBase: capaBase
  };
})();
