/* Sincronización de Casa Nueva con Firebase (Firestore + inicio de sesión con correo) */
(function(){
  "use strict";
  var cfg = window.FIREBASE_CONFIG;
  if(!cfg || !cfg.apiKey || cfg.apiKey === "PEGA_AQUI") return;
  if(typeof firebase === "undefined" || !window.CasaNueva) return;

  firebase.initializeApp(cfg);
  var auth = firebase.auth();
  /* la sesión queda guardada en el móvil: solo hay que entrar la primera vez */
  try{ auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){}); }catch(e){}
  var db = firebase.firestore();
  try{ db.enablePersistence({synchronizeTabs:true}).catch(function(){}); }catch(e){}
  var ref = db.collection("casas").doc("casa-nueva");
  var unsub = null, timer = null, gotFirst = false;

  /* panel de sesión, debajo del título */
  var box = document.createElement("section");
  box.className = "backup";
  box.style.marginTop = "0"; box.style.marginBottom = "16px";
  box.innerHTML =
    '<h3>Sincronización</h3><p id="syncStatus">Conectando…</p>' +
    '<form id="syncLogin" hidden>' +
      '<div class="field"><label for="syncEmail">Correo</label><input id="syncEmail" type="email" autocomplete="username"></div>' +
      '<div class="field"><label for="syncPass">Contraseña</label><input id="syncPass" type="password" autocomplete="current-password"></div>' +
      '<button type="submit" class="btn primary">Entrar</button>' +
    '</form>' +
    '<div class="row-btns" id="syncOut" hidden><button type="button" class="btn" id="syncLogout">Cerrar sesión</button></div>';
  var view = document.getElementById("view");
  view.parentNode.insertBefore(box, view);
  var statusEl = box.querySelector("#syncStatus");
  var small = document.createElement("p");
  small.style.cssText = "margin:12px 0 0;font-size:.8rem;color:var(--ink-soft)";
  small.innerHTML = '<span id="syncSmall"></span> · <button type="button" id="syncLogout2" style="background:none;border:none;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer">Cerrar sesión</button>';
  var backup = document.getElementById("exportBackup").closest("section");
  if(backup) backup.appendChild(small);
  small.hidden = true;
  small.querySelector("#syncLogout2").addEventListener("click", function(){ auth.signOut(); });
  var lastEmail = ""; try{ lastEmail = localStorage.getItem("casa-nueva-email") || ""; }catch(e){}
  box.querySelector("#syncEmail").value = lastEmail;
  function status(t){ statusEl.textContent = t; var sm = document.getElementById("syncSmall"); if(sm) sm.textContent = t; }

  box.querySelector("#syncLogin").addEventListener("submit", function(e){
    e.preventDefault();
    status("Entrando…");
    try{ localStorage.setItem("casa-nueva-email", box.querySelector("#syncEmail").value.trim()); }catch(e2){}
    auth.signInWithEmailAndPassword(box.querySelector("#syncEmail").value.trim(), box.querySelector("#syncPass").value)
      .catch(function(err){ status("No se pudo entrar: revisa el correo y la contraseña (" + err.code + ")."); });
  });
  box.querySelector("#syncLogout").addEventListener("click", function(){ auth.signOut(); });

  function pushNow(s){
    if(!auth.currentUser) return;
    ref.set({ json: JSON.stringify(s), savedAt: s.savedAt || Date.now(), by: auth.currentUser.email || "" })
      .then(function(){ status("Sincronizado · " + (auth.currentUser.email || "")); })
      .catch(function(err){ status("Error al guardar en la nube (" + err.code + ")."); });
  }

  window.CasaSync = {
    push: function(s){
      if(!auth.currentUser) return;
      status("Guardando…");
      clearTimeout(timer);
      timer = setTimeout(function(){ pushNow(s); }, 800);
    }
  };

  auth.onAuthStateChanged(function(user){
    if(unsub){ unsub(); unsub = null; }
    gotFirst = false;
    box.querySelector("#syncLogin").hidden = !!user;
    box.querySelector("#syncOut").hidden = true;
    box.hidden = !!user;      /* con sesión iniciada el panel desaparece */
    small.hidden = !user;
    if(!user){ status("Inicia sesión para compartir la lista entre los dos móviles."); return; }
    status("Cargando datos de la nube…");
    unsub = ref.onSnapshot(function(snap){
      if(snap.metadata.hasPendingWrites) return;
      var local = window.CasaNueva.getState();
      if(!snap.exists){ pushNow(local); gotFirst = true; return; }
      var d = snap.data(), remote = null;
      try{ remote = JSON.parse(d.json); }catch(e){}
      if(remote && (remote.savedAt || 0) > (local.savedAt || 0)){
        window.CasaNueva.setState(remote);
        if(gotFirst && d.by && d.by !== user.email) window.CasaNueva.toast("Actualizado por " + d.by);
      } else if(remote && (local.savedAt || 0) > (remote.savedAt || 0)){
        pushNow(local);
      }
      gotFirst = true;
      status("Sincronizado · " + (user.email || ""));
    }, function(err){
      status("Sin permiso o sin conexión (" + err.code + "). Revisa las reglas de Firestore.");
    });
  });
})();
