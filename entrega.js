// Prueba de entrega: foto comprimida y firma en pantalla.
// Se guardan en Firestore (colección "evidencias", un documento por pedido, máx. 1 MB),
// por eso la foto se reduce a ~100 KB: suficiente para comprobar la entrega.
var Entrega = (function () {
  var RELACIONES = ["Titular", "Familiar", "Conserje", "Vecino", "Otro"];
  var MOTIVOS = ["Cliente ausente", "Dirección incorrecta", "Rechazado por el cliente", "No se pudo acceder", "Otro"];

  function comprimirFoto(archivo, maxLado, calidad) {
    maxLado = maxLado || 900;
    calidad = calidad || 0.6;
    return new Promise(function (ok, falla) {
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var dato = c.toDataURL("image/jpeg", calidad);
        // Si aún quedó pesada (fotos muy detalladas), se baja un poco más.
        if (dato.length > 350000) dato = c.toDataURL("image/jpeg", 0.45);
        ok(dato);
      };
      img.onerror = function () { URL.revokeObjectURL(url); falla(new Error("No se pudo abrir la foto.")); };
      img.src = url;
    });
  }

  // Pad de firma sobre un <canvas>. Funciona con dedo, lápiz o mouse.
  function PadFirma(canvas) {
    var ctx = canvas.getContext("2d");
    var dibujando = false, trazos = 0, ultimo = null;

    function ajustar() {
      var r = canvas.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0b192c";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, r.width, r.height);
      trazos = 0;
    }

    function punto(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", function (e) {
      dibujando = true;
      ultimo = punto(e);
      canvas.setPointerCapture(e.pointerId);
      ctx.beginPath();
      ctx.arc(ultimo.x, ultimo.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = "#0b192c";
      ctx.fill();
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!dibujando) return;
      var p = punto(e);
      ctx.beginPath();
      ctx.moveTo(ultimo.x, ultimo.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ultimo = p;
    });
    function terminar() { if (dibujando) { dibujando = false; trazos++; } }
    canvas.addEventListener("pointerup", terminar);
    canvas.addEventListener("pointercancel", terminar);
    canvas.addEventListener("pointerleave", terminar);

    return {
      ajustar: ajustar,
      limpiar: ajustar,
      vacio: function () { return trazos === 0; },
      // JPEG con fondo blanco: pesa mucho menos que PNG.
      aImagen: function () {
        var c = document.createElement("canvas");
        var escala = Math.min(1, 600 / canvas.width);
        c.width = Math.round(canvas.width * escala);
        c.height = Math.round(canvas.height * escala);
        c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", 0.7);
      }
    };
  }

  return { RELACIONES: RELACIONES, MOTIVOS: MOTIVOS, comprimirFoto: comprimirFoto, PadFirma: PadFirma };
})();
