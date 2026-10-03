/* Sincronización de Gijón con Firebase (Realtime Database + inicio de sesión con correo) */
(function(){
  "use strict";
  var App = window.CasaNueva;
  if(!App) return;
  function badge(kind, label, detail){ if(App.setSync) App.setSync(kind, label, detail); }

  var cfg = window.FIREBASE_CONFIG;
  if(!cfg || !cfg.apiKey || cfg.apiKey === "PEGA_AQUI"){
    badge("off", "Sin sincronizar", "Faltan los datos de Firebase en firebase-config.js. Los cambios se guardan solo en este dispositivo.");
    return;
  }
  if(typeof firebase === "undefined"){
    badge("error", "Sin conexión", "No se pudo cargar Firebase (¿sin internet?). Los cambios se guardan en este dispositivo y se enviarán al volver a abrir la app con conexión.");
    return;
  }

  firebase.initializeApp(cfg);
  var auth = firebase.auth();
  /* la sesión queda guardada: solo hay que entrar la primera vez */
  try{ auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){}); }catch(e){}
  var ref = firebase.database().ref("casas/casa-nueva");
  var connected = false;
  firebase.database().ref(".info/connected").on("value", function(sn){
    connected = !!sn.val();
    if(!auth.currentUser) return;
    if(connected) syncNow();
    else if(!pending) badge("error", "Sin conexión", "Mostrando lo guardado en este dispositivo. Se pondrá al día al recuperar la conexión.");
  });
  var unsub = null, timer = null, pending = false, lastSync = 0;

  function hora(t){ try{ return new Date(t).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}); }catch(e){ return ""; } }
  function okBadge(){
    var u = auth.currentUser;
    badge("ok", "Al día", "Todo está guardado en la nube" + (lastSync ? " (última vez a las " + hora(lastSync) + ")" : "") + ". Sesión: " + (u && u.email || "") + ".");
  }

  /* panel de inicio de sesión (solo se ve si no hay sesión) */
  var box = document.createElement("section");
  box.className = "backup";
  box.style.marginTop = "0"; box.style.marginBottom = "16px";
  box.hidden = true;
  box.innerHTML =
    '<h3>Sincronización</h3><p id="syncStatus">Inicia sesión para compartir los datos entre el ordenador y los móviles.</p>' +
    '<form id="syncLogin">' +
      '<div class="field"><label for="syncEmail">Correo</label><input id="syncEmail" type="email" autocomplete="username"></div>' +
      '<div class="field"><label for="syncPass">Contraseña</label><input id="syncPass" type="password" autocomplete="current-password"></div>' +
      '<button type="submit" class="btn primary">Entrar</button>' +
    '</form>';
  var view = document.getElementById("view");
  view.parentNode.insertBefore(box, view);
  var statusEl = box.querySelector("#syncStatus");
  try{ box.querySelector("#syncEmail").value = localStorage.getItem("casa-nueva-email") || ""; }catch(e){}

  box.querySelector("#syncLogin").addEventListener("submit", function(e){
    e.preventDefault();
    var email = box.querySelector("#syncEmail").value.trim();
    statusEl.textContent = "Entrando…";
    try{ localStorage.setItem("casa-nueva-email", email); }catch(e2){}
    auth.signInWithEmailAndPassword(email, box.querySelector("#syncPass").value)
      .catch(function(err){ statusEl.textContent = "No se pudo entrar: revisa el correo y la contraseña (" + err.code + ")."; });
  });

  function pushNow(s){
    if(!auth.currentUser) return;
    pending = true;
    badge("saving", "Guardando…", "Enviando los cambios a la nube.");
    ref.set({ json: JSON.stringify(s), savedAt: s.savedAt || Date.now(), by: auth.currentUser.email || "" })
      .then(function(){ pending = false; lastSync = Date.now(); okBadge(); })
      .catch(function(err){
        pending = false;
        badge("error", "Error", "No se pudo guardar en la nube (" + err.code + "). " +
          (/permission/i.test(err.code||err.message||"") ? "Revisa que tu correo esté en las reglas de la base de datos." : "Comprueba la conexión."));
      });
  }

  /* compara lo que hay en la nube con lo de este dispositivo y se queda con lo más reciente */
  function apply(d, user, fromServer){
    var local = App.getState(), remote = null;
    try{ remote = JSON.parse(d.json); }catch(e){}
    if(!remote) return;
    if((remote.savedAt || 0) > (local.savedAt || 0)){
      App.setState(remote);
      if(fromServer && d.by && d.by !== user.email) App.toast("Actualizado por " + d.by);
    } else if((local.savedAt || 0) > (remote.savedAt || 0) && fromServer){
      pushNow(local);
    }
  }

  function syncNow(){
    var user = auth.currentUser;
    if(!user) return;
    badge("saving", "Comprobando…", "Buscando cambios en la nube.");
    ref.get().then(function(snap){
      lastSync = Date.now();
      if(snap.exists()) apply(snap.val(), user, true); else pushNow(App.getState());
      if(!pending) okBadge();
    }).catch(function(err){
      badge("error", "Sin conexión", "No se pudo contactar con la nube (" + err.code + "). Los cambios quedan guardados en este dispositivo.");
    });
  }

  window.CasaSync = {
    push: function(s){
      if(!auth.currentUser) return;
      badge("saving", "Guardando…", "Enviando los cambios a la nube.");
      clearTimeout(timer);
      timer = setTimeout(function(){ pushNow(s); }, 600);
    },
    syncNow: syncNow,
    signOut: function(){ auth.signOut(); },
    signedIn: function(){ return !!auth.currentUser; }
  };

  auth.onAuthStateChanged(function(user){
    if(unsub){ ref.off("value", unsub); unsub = null; }
    box.hidden = !!user;
    if(!user){ badge("login", "Inicia sesión", "Entra con tu correo para sincronizar con los demás dispositivos."); return; }
    badge("saving", "Conectando…", "Cargando los datos de la nube.");
    unsub = ref.on("value", function(snap){
      if(!snap.exists()){ pushNow(App.getState()); return; }
      apply(snap.val(), user, true);
      lastSync = Date.now(); if(!pending) okBadge();
    }, function(err){
      badge("error", "Error", "Sin permiso (" + (err.code || err.message) + "). Revisa que tu correo esté en las reglas de la base de datos y que hayas entrado con él.");
    });
  });

  /* al volver a la app (desde otra app o al desbloquear el móvil) busca cambios */
  document.addEventListener("visibilitychange", function(){ if(document.visibilityState === "visible") syncNow(); });
  window.addEventListener("online", syncNow);
  window.addEventListener("offline", function(){ badge("error", "Sin conexión", "El dispositivo no tiene internet. Los cambios se enviarán al recuperarla."); });
})();
