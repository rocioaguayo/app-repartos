// "Cambiar mi contraseña" desde dentro de la app (admin, repartidor, tienda y cliente).
// Uso: Cuenta.instalar(auth, "idDelBotonSalir") — agrega un botón 🔑 junto a "Salir".
// Firebase exige confirmar la clave actual antes de poner una nueva.
var Cuenta = (function () {
  var estilos =
    ".cta-btn{background:#172554;border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:8px 12px;font:700 12px 'Plus Jakarta Sans',sans-serif;color:#cbd5e1;cursor:pointer;margin-right:6px;text-decoration:none}" +
    ".cta-btn:hover{background:#ff6500;color:#fff;border-color:#ff6500}" +
    ".cta-fondo{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;z-index:200;padding:16px}" +
    ".cta-fondo.visible{display:flex}" +
    ".cta-caja{background:#1e3e62;width:100%;max-width:400px;border-radius:18px;padding:22px;border:2px solid #ff6500;color:#fff;font-family:'Plus Jakarta Sans',Arial,sans-serif}" +
    ".cta-caja h3{margin:0 0 4px;font-size:17px;font-weight:800}" +
    ".cta-caja p{margin:0 0 14px;font-size:13px;color:#cbd5e1}" +
    ".cta-caja label{display:block;font-size:12px;font-weight:700;color:#cbd5e1;margin:10px 0 5px}" +
    ".cta-caja input[type=password],.cta-caja input[type=text]{width:100%;box-sizing:border-box;padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#0b192c;color:#fff;font:15px 'Plus Jakarta Sans',sans-serif}" +
    ".cta-caja input:focus{outline:none;border-color:#ff6500}" +
    ".cta-ver{display:flex;align-items:center;gap:6px;font-size:12px;color:#cbd5e1;margin-top:10px}" +
    ".cta-msg{font-size:13px;font-weight:600;border-radius:8px;padding:9px;margin-top:12px;display:none}" +
    ".cta-msg.error{display:block;background:rgba(239,68,68,.15);color:#fca5a5}" +
    ".cta-msg.ok{display:block;background:rgba(16,185,129,.15);color:#6ee7b7}" +
    ".cta-guardar{width:100%;margin-top:14px;padding:13px;border:none;border-radius:12px;background:#ff6500;color:#fff;font:800 14px 'Plus Jakarta Sans',sans-serif;cursor:pointer}" +
    ".cta-guardar:disabled{opacity:.6}" +
    ".cta-sec{width:100%;margin-top:6px;padding:10px;border:none;background:none;color:#cbd5e1;font:600 13px 'Plus Jakarta Sans',sans-serif;cursor:pointer}" +
    ".cta-sec:hover{color:#ff6500}";

  var auth = null;

  function el(id) { return document.getElementById(id); }

  function mensaje(texto, tipo) {
    var m = el("ctaMsg");
    m.textContent = texto;
    m.className = "cta-msg " + (tipo || "");
  }

  function crearVentana() {
    var st = document.createElement("style");
    st.textContent = estilos;
    document.head.appendChild(st);
    var fondo = document.createElement("div");
    fondo.className = "cta-fondo";
    fondo.id = "ctaFondo";
    fondo.innerHTML =
      "<div class='cta-caja' role='dialog' aria-labelledby='ctaTitulo'>" +
      "<h3 id='ctaTitulo'>🔑 Cambiar mi contraseña</h3>" +
      "<p id='ctaCorreo'></p>" +
      "<label for='ctaActual'>Contraseña actual</label><input type='password' id='ctaActual' autocomplete='current-password'>" +
      "<label for='ctaNueva'>Contraseña nueva (mínimo 6 caracteres)</label><input type='password' id='ctaNueva' autocomplete='new-password'>" +
      "<label for='ctaRepetir'>Repite la contraseña nueva</label><input type='password' id='ctaRepetir' autocomplete='new-password'>" +
      "<label class='cta-ver'><input type='checkbox' id='ctaVer'> Mostrar contraseñas</label>" +
      "<div class='cta-msg' id='ctaMsg'></div>" +
      "<button class='cta-guardar' id='ctaGuardar'>Guardar contraseña nueva</button>" +
      "<button class='cta-sec' id='ctaOlvide'>No recuerdo mi contraseña actual</button>" +
      "<button class='cta-sec' id='ctaCerrar'>Cerrar</button>" +
      "</div>";
    document.body.appendChild(fondo);

    el("ctaVer").addEventListener("change", function (e) {
      ["ctaActual", "ctaNueva", "ctaRepetir"].forEach(function (id) { el(id).type = e.target.checked ? "text" : "password"; });
    });
    el("ctaCerrar").addEventListener("click", cerrar);
    el("ctaGuardar").addEventListener("click", guardar);
    el("ctaRepetir").addEventListener("keydown", function (e) { if (e.key === "Enter") guardar(); });
    el("ctaOlvide").addEventListener("click", function () {
      var u = auth.currentUser;
      if (!u) return;
      auth.languageCode = "es";
      auth.sendPasswordResetEmail(u.email).then(function () {
        mensaje("Te enviamos un correo a " + u.email + ". Usa solo el ÚLTIMO correo que llegue y ábrelo antes de una hora.", "ok");
      }).catch(function (e) { mensaje("No se pudo enviar el correo: " + e.message, "error"); });
    });
  }

  function abrir() {
    var u = auth.currentUser;
    if (!u) return;
    ["ctaActual", "ctaNueva", "ctaRepetir"].forEach(function (id) { el(id).value = ""; });
    el("ctaCorreo").textContent = "Cuenta: " + u.email;
    mensaje("", "");
    el("ctaFondo").classList.add("visible");
    el("ctaActual").focus();
  }

  function cerrar() { el("ctaFondo").classList.remove("visible"); }

  function guardar() {
    var u = auth.currentUser;
    var actual = el("ctaActual").value, nueva = el("ctaNueva").value, repetir = el("ctaRepetir").value;
    if (!actual) return mensaje("Escribe tu contraseña actual.", "error");
    if (nueva.length < 6) return mensaje("La contraseña nueva debe tener al menos 6 caracteres.", "error");
    if (nueva !== repetir) return mensaje("Las dos contraseñas nuevas no coinciden.", "error");
    if (nueva === actual) return mensaje("La contraseña nueva debe ser distinta de la actual.", "error");
    var btn = el("ctaGuardar");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    var credencial = firebase.auth.EmailAuthProvider.credential(u.email, actual);
    u.reauthenticateWithCredential(credencial).then(function () {
      return u.updatePassword(nueva);
    }).then(function () {
      mensaje("✅ Listo. Desde ahora entras con tu contraseña nueva.", "ok");
      ["ctaActual", "ctaNueva", "ctaRepetir"].forEach(function (id) { el(id).value = ""; });
    }).catch(function (e) {
      var m = "No se pudo cambiar la contraseña: " + e.message;
      if (["auth/wrong-password", "auth/invalid-credential", "auth/invalid-login-credentials"].indexOf(e.code) > -1) m = "La contraseña actual no es correcta.";
      else if (e.code === "auth/weak-password") m = "La contraseña nueva es muy débil: usa al menos 6 caracteres.";
      else if (e.code === "auth/too-many-requests") m = "Demasiados intentos. Espera unos minutos.";
      else if (e.code === "auth/network-request-failed") m = "Sin conexión. Intenta cuando tengas señal.";
      mensaje(m, "error");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "Guardar contraseña nueva";
    });
  }

  function instalar(authFirebase, idBotonSalir) {
    auth = authFirebase;
    crearVentana();
    var salir = el(idBotonSalir);
    var b = document.createElement("button");
    b.type = "button";
    b.className = "cta-btn";
    b.title = "Cambiar mi contraseña";
    b.textContent = "🔑 Clave";
    b.addEventListener("click", abrir);
    if (salir && salir.parentNode) {
      var grupo = document.createElement("div");
      grupo.style.display = "flex";
      grupo.style.alignItems = "center";
      grupo.style.flexShrink = "0";
      salir.parentNode.insertBefore(grupo, salir);
      grupo.appendChild(b);
      grupo.appendChild(salir);
    }
  }

  return { instalar: instalar };
})();
