import { CONFIG } from './config.js';

/**
 * STATE: Single source of truth for the application
 */
let STATE = {
    data: null,
    selectedEventId: null,
    selectedJudgeId: null,
    selectedPistaId: null,
    selectedGroupIds: [], // Multiple groups allowed
    selectedResultView: null, // "razas", "grupos", "bis"
    lastUpdate: null,
    isFirstLoad: true
};

// --- HELPERS ---

const normalizeID = (id) => id ? String(id).trim() : "";

const isTruthy = (v) => {
    if (v === null || v === undefined) return false;
    const s = String(v).toLowerCase().trim();
    return ["true", "1", "si", "sí", "x"].includes(s) || v === true;
};

const normalizeGrupo = (gr) => {
    if (!gr) return "G?";
    const s = String(gr).trim().toUpperCase();
    return s.startsWith("G") ? s : `G${s}`;
};

const byId = (list, keyName, value) => {
    if (!list || !Array.isArray(list)) return null;
    const val = normalizeID(value);
    return list.find(item => normalizeID(item[keyName]) === val);
};

// CATEGORÍAS CANÓNICAS
const getSuperCat = (idCat) => {
    const id = normalizeID(idCat);
    if (id === 'C00') return "Cachorros Especiales";
    if (id === 'C01') return "Cachorros";
    if (['C02', 'C03'].includes(id)) return "Jóvenes";
    if (['C04', 'C05', 'C06', 'C07', 'C08'].includes(id)) return "Abierta / Adultos";
    return "Otras";
};

// TipoBIS Canónico basado en IDCategoria
const getTipoBIS = (idCat) => {
    const id = normalizeID(idCat);
    if (id === 'C00') return "BIS CACHORROS ESPECIALES";
    if (id === 'C01') return "BIS CACHORROS";
    if (['C02', 'C03'].includes(id)) return "BIS JOVENES";
    if (['C04', 'C05', 'C06', 'C07', 'C08'].includes(id)) return "BIS ADULTOS";
    return "BIS OTROS";
};

function formatDateAR(value) {
    if (!value) return "";
    const s = String(value);
    const datePart = s.includes("T") ? s.split("T")[0] : s.split(" ")[0];
    const parts = datePart.split("-");
    if (parts.length === 3) {
        const [y, m, d] = parts;
        return `${d}/${m}/${y}`;
    }
    return s;
}

const formatTime = (date) => {
    if (!date) return "--:--:--";
    return date.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
};

// --- DATA LOADING ---

async function loadPublicResults() {
    const updateStatus = document.getElementById('updateStatus');
    const updateBtn = document.getElementById('updateBtn');

    try {
        if (updateBtn) updateBtn.disabled = true;
        updateStatus.textContent = "Sincronizando...";

        const response = await fetch(CONFIG.PUBLIC_API_URL);
        if (!response.ok) throw new Error("Error de conexión");

        const json = await response.json();

        if (json.ok) {
            STATE.data = json.data;
            STATE.lastUpdate = new Date();

            const events = STATE.data.Eventos || [];
            if (events.length > 0) {
                if (STATE.isFirstLoad || !byId(events, 'IDEvento', STATE.selectedEventId)) {
                    STATE.selectedEventId = normalizeID(events[events.length - 1].IDEvento);
                }
            } else {
                STATE.selectedEventId = null;
            }

            // Maintain selection if it still exists
            const tracks = STATE.data.Gestion_pistas || [];
            const stillExists = tracks.some(p =>
                normalizeID(p.IDEvento) === STATE.selectedEventId &&
                normalizeID(p.IDPista) === STATE.selectedPistaId &&
                normalizeID(p.IDJuez) === STATE.selectedJudgeId
            );

            if (!stillExists) {
                STATE.selectedJudgeId = null;
                STATE.selectedPistaId = null;
                STATE.selectedGroupIds = [];
                STATE.selectedResultView = null;
            } else {
                // Filter group selection against existing groups for this judge
                const availableGroups = tracks
                    .filter(p =>
                        normalizeID(p.IDEvento) === STATE.selectedEventId &&
                        normalizeID(p.IDPista) === STATE.selectedPistaId &&
                        normalizeID(p.IDJuez) === STATE.selectedJudgeId
                    )
                    .map(p => normalizeGrupo(p.IDGrupo));

                STATE.selectedGroupIds = STATE.selectedGroupIds.filter(g => availableGroups.includes(g));
            }

            STATE.isFirstLoad = false;
            renderAll();
            updateStatus.textContent = `Actualizado: ${formatTime(STATE.lastUpdate)}`;
        } else {
            throw new Error("Respuesta inválida");
        }
    } catch (error) {
        console.error("Error loading results:", error);
        updateStatus.innerHTML = `<span style="color: #98252b;">Error al cargar. Reintentar.</span>`;
    } finally {
        if (updateBtn) updateBtn.disabled = false;
    }
}

// --- NAVIGATION HANDLERS ---

window.selectTrack = (idPista, idJuez) => {
    const isSameTrack =
        normalizeID(STATE.selectedPistaId) === normalizeID(idPista) &&
        normalizeID(STATE.selectedJudgeId) === normalizeID(idJuez);

    if (isSameTrack) return;

    STATE.selectedPistaId = normalizeID(idPista);
    STATE.selectedJudgeId = normalizeID(idJuez);
    STATE.selectedGroupIds = [];
    STATE.selectedResultView = null;
    renderAll();
};

window.selectGroupToggle = (event, idPista, idJuez, idGrupo) => {
    if (event) event.stopPropagation();

    if (STATE.selectedPistaId !== normalizeID(idPista) || STATE.selectedJudgeId !== normalizeID(idJuez)) {
        STATE.selectedPistaId = normalizeID(idPista);
        STATE.selectedJudgeId = normalizeID(idJuez);
        STATE.selectedGroupIds = [];
        STATE.selectedResultView = null;
    }

    const group = normalizeGrupo(idGrupo);
    const index = STATE.selectedGroupIds.indexOf(group);

    if (index === -1) {
        STATE.selectedGroupIds.push(group);
    } else {
        STATE.selectedGroupIds.splice(index, 1);
    }

    renderAll();
};

window.setResultView = (viewType) => {
    STATE.selectedResultView = viewType;
    renderAll();
};

// --- RENDERING FUNCTIONS ---

function renderEventSelector() {
    const selector = document.getElementById('eventSelector');
    if (!selector) return;

    if (!STATE.data?.Eventos || STATE.data.Eventos.length === 0) {
        selector.innerHTML = `<option value="">No hay eventos disponibles</option>`;
        return;
    }

    const currentVal = STATE.selectedEventId;
    selector.innerHTML = STATE.data.Eventos.map(ev => `
        <option value="${ev.IDEvento}" ${normalizeID(ev.IDEvento) === currentVal ? 'selected' : ''}>
            ${ev.NombreEvento} (${formatDateAR(ev.Fecha)})
        </option>
    `).join('');

    selector.onchange = (e) => {
        STATE.selectedEventId = normalizeID(e.target.value);
        STATE.selectedJudgeId = null;
        STATE.selectedPistaId = null;
        STATE.selectedGroupIds = [];
        STATE.selectedResultView = null;
        renderAll();
    };
}

function renderEventSummary() {
    const container = document.getElementById('eventSummaryContainer');
    if (!container) return;

    const event = byId(STATE.data?.Eventos, 'IDEvento', STATE.selectedEventId);
    if (!event) { container.innerHTML = ""; return; }

    container.innerHTML = `
        <div class="event-summary">
            <h3>${event.NombreEvento}</h3>
            <p>${formatDateAR(event.Fecha)} • ${event.Lugar}</p>
        </div>
    `;
}

function renderPistas() {
    const container = document.getElementById('pistasContainer');
    if (!container) return;

    const pistas = (STATE.data?.Gestion_pistas || []).filter(p => normalizeID(p.IDEvento) === STATE.selectedEventId);

    if (pistas.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay pistas asignadas para este evento.</div>`;
        return;
    }

    const grouped = {};
    pistas.forEach(p => {
        const key = `${p.IDPista}_${p.IDJuez}`;
        if (!grouped[key]) {
            const judge = byId(STATE.data?.Jueces, 'IDJuez', p.IDJuez);
            grouped[key] = {
                idPista: normalizeID(p.IDPista),
                idJuez: normalizeID(p.IDJuez),
                juez: judge ? judge.NombreJuez : "Juez no asignado",
                grupos: new Set()
            };
        }
        if (p.IDGrupo) grouped[key].grupos.add(normalizeGrupo(p.IDGrupo));
    });

    container.innerHTML = Object.values(grouped).map(track => {
        const isTrackActive = (STATE.selectedPistaId === track.idPista && STATE.selectedJudgeId === track.idJuez);
        return `
            <div class="track-card ${isTrackActive ? 'active' : ''}" 
                 onclick="window.selectTrack('${track.idPista}', '${track.idJuez}')">
                <div class="track-number">Pista ${track.idPista}</div>
                <div class="track-judge">${track.juez}</div>
                <div class="track-groups">
                    ${Array.from(track.grupos).sort().map(g => {
            const isGroupActive = isTrackActive && STATE.selectedGroupIds.includes(g);
            return `
                            <span class="group-tag clickable ${isGroupActive ? 'active' : ''}" 
                                  onclick="window.selectGroupToggle(event, '${track.idPista}', '${track.idJuez}', '${g}')">
                                ${g}
                            </span>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function renderResultViewSelector() {
    let navContainer = document.getElementById('navigationControls');
    if (!navContainer) {
        navContainer = document.createElement('div');
        navContainer.id = 'navigationControls';
        const pistas = document.getElementById('pistasContainer');
        if (pistas) pistas.after(navContainer);
    }

    if (!navContainer) return;

    let selectorHtml = "";

    if (!STATE.selectedJudgeId) {
        selectorHtml = `<div class="selection-message info">Seleccioná una pista/juez para comenzar.</div>`;
    } else {
        const judge = byId(STATE.data?.Jueces, 'IDJuez', STATE.selectedJudgeId);
        const groupText = STATE.selectedGroupIds.length > 0 ? ` — ${STATE.selectedGroupIds.sort().join(', ')}` : '';
        const contextTitle = STATE.selectedResultView === 'bis' ? 'Consultando BIS' : 'Consultando';

        selectorHtml = `
            <div class="result-view-selector">
                <div class="selected-context">
                    ${contextTitle}: <strong>Pista ${STATE.selectedPistaId} — ${judge ? judge.NombreJuez : ''}${groupText}</strong>
                </div>
                <div class="view-buttons">
                    <button class="result-view-btn ${STATE.selectedResultView === 'razas' ? 'active' : ''}" 
                            onclick="window.setResultView('razas')">Resultados Razas</button>
                    <button class="result-view-btn ${STATE.selectedResultView === 'grupos' ? 'active' : ''}" 
                            onclick="window.setResultView('grupos')">Final Grupo</button>
                    <button class="result-view-btn ${STATE.selectedResultView === 'bis' ? 'active' : ''}" 
                            onclick="window.setResultView('bis')">Finales BIS</button>
                </div>
            </div>
        `;
    }

    navContainer.innerHTML = selectorHtml;
}

function renderResultadosRazas() {
    const container = document.getElementById('razasContainer');
    if (!container) return;

    const selectedGroups = STATE.selectedGroupIds || [];
    if (selectedGroups.length === 0) {
        container.innerHTML = `<div class="empty-state">Seleccioná uno o más grupos para ver resultados de razas.</div>`;
        return;
    }

    const results = (STATE.data?.Resultados_Razas || []).filter(r => {
        if (normalizeID(r.IDEvento) !== STATE.selectedEventId) return false;
        if (normalizeID(r.IDJuez) !== STATE.selectedJudgeId) return false;

        // Show if it has a placement, qualification, title OR is absent
        if (!(r.Puesto || r.Calificacion || r.Titulo_Ganado || isTruthy(r.Ausente))) return false;

        const dog = byId(STATE.data?.Catalogo_Perros_Inscriptos, 'IDInscripcion', r.IDInscripcion);
        return dog && selectedGroups.includes(normalizeGrupo(dog.IDGrupo));
    });

    if (results.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay resultados de razas cargados para los grupos seleccionados.</div>`;
        return;
    }

    // Strict category order for Razas
    const getSuperCatRazas = (idCat) => {
        const id = normalizeID(idCat);
        if (id === 'C00') return "CACHORROS ESPECIALES";
        if (id === 'C01') return "CACHORROS";
        if (['C02', 'C03'].includes(id)) return "JÓVENES";
        if (['C04', 'C05', 'C06', 'C07'].includes(id)) return "ABIERTAS";
        return "OTRAS";
    };

    const categoriesOrder = ["CACHORROS ESPECIALES", "CACHORROS", "JÓVENES", "ABIERTAS", "OTRAS"];

    const tree = {};
    results.forEach(res => {
        const dog = byId(STATE.data?.Catalogo_Perros_Inscriptos, 'IDInscripcion', res.IDInscripcion);
        const grupoId = normalizeGrupo(dog.IDGrupo);
        const raza = byId(STATE.data?.Catalogo_Razas, 'IDRaza', dog.IDRaza)?.NombreRaza || "Raza desconocida";
        const sCat = getSuperCatRazas(dog.IDCategoria);
        const sexo = byId(STATE.data?.Catalogo_Sexos, 'IDSexo', dog.IDSexo)?.NombreSexo || "";
        const catName = byId(STATE.data?.Catalogo_Categorias, 'IDCategoria', dog.IDCategoria)?.NombreCategoria || "Cat.";

        if (!tree[grupoId]) tree[grupoId] = {};
        if (!tree[grupoId][raza]) tree[grupoId][raza] = {};
        if (!tree[grupoId][raza][sCat]) tree[grupoId][raza][sCat] = [];
        tree[grupoId][raza][sCat].push({ ...res, dog, raza, sCat, sexo, catName });
    });

    let html = "";
    Object.keys(tree).sort().forEach(gr => {
        html += `<h3 class="group-header">${gr}</h3>`;
        Object.keys(tree[gr]).sort().forEach(rz => {
            html += `<div class="result-card"><div class="result-card-header">${rz}</div><div class="result-body">`;

            let firstBlock = true;
            categoriesOrder.forEach(sc => {
                if (!tree[gr][rz][sc]) return;

                // Category separator
                if (!firstBlock) {
                    html += `<div class="raza-category-separator"></div>`;
                }

                html += `<div class="raza-category-block">`;
                html += `<div class="raza-category-title">${sc}</div>`;

                tree[gr][rz][sc].sort((a, b) => {
                    if (isTruthy(a.Ausente)) return 100;
                    if (isTruthy(b.Ausente)) return -100;
                    return (parseInt(a.Puesto) || 99) - (parseInt(b.Puesto) || 99);
                }).forEach(d => {
                    const isAus = isTruthy(d.Ausente);
                    let placeClass = 'place-other';
                    if (!isAus) {
                        if (d.Puesto == 1) placeClass = 'place-1';
                        else if (d.Puesto == 2) placeClass = 'place-2';
                        else if (d.Puesto == 3) placeClass = 'place-3';
                        else if (d.Puesto == 4) placeClass = 'place-4';
                    }

                    html += `
                        <div class="result-item ${isAus ? 'ausente-item' : ''}">
                            <div class="result-info" style="width: 100%;">
                                <div class="dog-title">#${d.dog.NumeroCatalogo} — ${rz}</div>
                                <div class="dog-subtitle">${d.sexo} | ${d.catName}</div>
                                <div class="dog-meta">
                                    <strong>Identificación:</strong> ${d.dog.Observaciones || 'Sin datos'}
                                </div>
                                <div class="result-labels">
                                    ${d.Calificacion ? `<span class="label label-qualification">${d.Calificacion}</span>` : ''}
                                    ${d.Titulo_Ganado ? `<span class="label label-title">${d.Titulo_Ganado}</span>` : ''}
                                </div>
                                <div class="public-indicators">
                                    <div class="public-indicator-btn btn-aus ${isAus ? 'active' : ''}">AUS</div>
                                    <div class="public-indicator-btn btn-1 ${d.Puesto == 1 && !isAus ? 'active' : ''}">1º</div>
                                    <div class="public-indicator-btn btn-2 ${d.Puesto == 2 && !isAus ? 'active' : ''}">2º</div>
                                    <div class="public-indicator-btn btn-3 ${d.Puesto == 3 && !isAus ? 'active' : ''}">3º</div>
                                    <div class="public-indicator-btn btn-4 ${d.Puesto == 4 && !isAus ? 'active' : ''}">4º</div>
                                </div>
                            </div>
                        </div>
                    `;
                });
                html += `</div>`;
                firstBlock = false;
            });

            html += `</div></div>`;
        });
    });
    container.innerHTML = html;
}

function renderResultadosGrupos() {
    const container = document.getElementById('gruposContainer');
    if (!container) return;

    const selectedGroups = STATE.selectedGroupIds || [];
    if (selectedGroups.length === 0) {
        container.innerHTML = `<div class="empty-state">Seleccioná uno o más grupos para ver los resultados oficiales.</div>`;
        return;
    }

    // 1. Get official results from Resultados_Grupos (Primary Source)
    const results = (STATE.data?.Resultados_Grupos || []).filter(r =>
        normalizeID(r.IDEvento) === STATE.selectedEventId &&
        normalizeID(r.IDJuez) === STATE.selectedJudgeId &&
        selectedGroups.includes(normalizeGrupo(r.IDGrupo)) &&
        (r.PuestoGrupo || isTruthy(r.Ausente))
    );

    if (results.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay resultados oficiales publicados para esta selección todavía.</div>`;
        return;
    }

    const categories = ["Cachorros Especiales", "Cachorros", "Jóvenes", "Abierta / Adultos"];
    const tree = {};
    categories.forEach(c => tree[c] = {});

    // 2. Process results and cross-reference with catalog
    results.forEach(res => {
        const dog = byId(STATE.data?.Catalogo_Perros_Inscriptos, 'IDInscripcion', res.IDInscripcion);
        if (!dog) return;

        const sCat = getSuperCat(dog.IDCategoria);
        const gr = normalizeGrupo(dog.IDGrupo);

        if (!tree[sCat][gr]) tree[sCat][gr] = [];
        tree[sCat][gr].push({ dog, res });
    });

    let html = `<div class="finales-categorias-grid">`;
    categories.forEach(sc => {
        html += `
            <div class="finales-categoria-card">
                <div class="category-title">${sc}</div>
                <div class="category-results">
        `;

        // Sort groups numerically (G1, G2...)
        const groupsInCat = Object.keys(tree[sc]).sort((a, b) => {
            const nA = parseInt(a.replace(/\D/g, '')) || 0;
            const nB = parseInt(b.replace(/\D/g, '')) || 0;
            return nA - nB;
        });

        if (groupsInCat.length === 0) {
            html += `<div class="empty-state mini">Sin resultados oficiales</div>`;
        } else {
            groupsInCat.forEach(gr => {
                html += `<div class="grupo-subtitle">${gr}</div>`;

                const groupResults = tree[sc][gr];
                // Sort by placement: 1, 2, 3, 4, then Ausentes
                groupResults.sort((a, b) => {
                    if (isTruthy(a.res.Ausente)) return 100;
                    if (isTruthy(b.res.Ausente)) return -100;
                    return (parseInt(a.res.PuestoGrupo) || 99) - (parseInt(b.res.PuestoGrupo) || 99);
                }).forEach(item => {
                    const isAus = isTruthy(item.res.Ausente);
                    const p = item.res.PuestoGrupo || "";
                    const rz = byId(STATE.data?.Catalogo_Razas, 'IDRaza', item.dog.IDRaza)?.NombreRaza || "Raza desconocida";

                    html += `
                        <div class="result-card mini ${isAus ? 'ausente-card' : ''}">
                            <div class="result-body mini">
                                <div class="result-item mini">
                                    <div class="result-info" style="width: 100%;">
                                        <div class="dog-title mini">#${item.dog.NumeroCatalogo} — ${rz}</div>
                                        <div class="dog-subtitle">${item.dog.Observaciones || ''}</div>
                                        <div class="public-indicators">
                                            <div class="public-indicator-btn btn-aus ${isAus ? 'active' : ''}">AUS</div>
                                            <div class="public-indicator-btn btn-1 ${p == 1 && !isAus ? 'active' : ''}">1º</div>
                                            <div class="public-indicator-btn btn-2 ${p == 2 && !isAus ? 'active' : ''}">2º</div>
                                            <div class="public-indicator-btn btn-3 ${p == 3 && !isAus ? 'active' : ''}">3º</div>
                                            <div class="public-indicator-btn btn-4 ${p == 4 && !isAus ? 'active' : ''}">4º</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                });
            });
        }
        html += `</div></div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
}









































function renderResultadosBis() {
    const container = document.getElementById('bisContainer');
    if (!container) return;

    if (!STATE.selectedJudgeId) {
        container.innerHTML = `<div class="selection-message info">Seleccioná un juez para ver la Final BIS.</div>`;
        return;
    }

    // 1. Get candidates: ONLY winners of Group Finals FOR THE SELECTED JUDGE
    const candidates = (STATE.data?.Resultados_Grupos || []).filter(r =>
        normalizeID(r.IDEvento) === STATE.selectedEventId &&
        normalizeID(r.IDJuez) === STATE.selectedJudgeId &&
        parseInt(r.PuestoGrupo) === 1 &&
        !isTruthy(r.Ausente)
    );

    if (candidates.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay candidatos para BIS (ganadores de grupo de este juez) cargados.</div>`;
        return;
    }

    // 2. SANITIZATION: Existing BIS results for this judge (unique by dog)
    const bisMap = new Map();
    (STATE.data?.Resultados_BIS || []).forEach(r => {
        if (normalizeID(r.IDEvento) === STATE.selectedEventId &&
            normalizeID(r.IDJuez) === STATE.selectedJudgeId) {
            bisMap.set(normalizeID(r.IDInscripcion), r);
        }
    });

    const categories = ["Cachorros Especiales", "Cachorros", "Jóvenes", "Abierta / Adultos"];
    const tree = {};

    candidates.forEach(cand => {
        const dog = byId(STATE.data?.Catalogo_Perros_Inscriptos, 'IDInscripcion', cand.IDInscripcion);
        if (!dog) return;

        const sCat = getSuperCat(dog.IDCategoria);
        const rz = byId(STATE.data?.Catalogo_Razas, 'IDRaza', dog.IDRaza)?.NombreRaza || "Raza desconocida";
        const res = bisMap.get(normalizeID(dog.IDInscripcion));

        if (!tree[sCat]) tree[sCat] = [];
        tree[sCat].push({ dog, res, rz, grupo: normalizeGrupo(dog.IDGrupo) });
    });

    let html = `<div class="finales-categorias-grid">`;
    categories.forEach(sc => {
        const catItems = tree[sc] || [];
        html += `
            <div class="finales-categoria-card">
                <div class="category-title">${sc}</div>
                <div class="category-results">
        `;

        if (catItems.length === 0) {
            html += `<div class="empty-state mini">Sin candidatos</div>`;
        } else {
            catItems.sort((a, b) => {
                if (isTruthy(a.res?.Ausente)) return 100;
                if (isTruthy(b.res?.Ausente)) return -100;
                return (parseInt(a.res?.PuestoBIS) || 99) - (parseInt(b.res?.PuestoBIS) || 99);
            }).forEach(item => {
                const isAus = isTruthy(item.res?.Ausente);
                const p = item.res?.PuestoBIS || "";

                html += `
                    <div class="result-card mini ${isAus ? 'ausente-card' : ''}">
                        <div class="result-body mini">
                            <div class="result-item mini">
                                <div class="result-info" style="width: 100%;">
                                    <div class="dog-title mini">${item.grupo} — #${item.dog.NumeroCatalogo}</div>
                                    <div class="dog-subtitle">${item.rz}</div>
                                    <div class="dog-meta mini">Cat. Orig: ${item.dog.IDCategoria} | ${item.dog.Observaciones || ''}</div>
                                    <div class="public-indicators">
                                        <div class="public-indicator-btn btn-aus ${isAus ? 'active' : ''}">AUS</div>
                                        <div class="public-indicator-btn btn-1 ${p == 1 && !isAus ? 'active' : ''}">1º</div>
                                        <div class="public-indicator-btn btn-2 ${p == 2 && !isAus ? 'active' : ''}">2º</div>
                                        <div class="public-indicator-btn btn-3 ${p == 3 && !isAus ? 'active' : ''}">3º</div>
                                        <div class="public-indicator-btn btn-4 ${p == 4 && !isAus ? 'active' : ''}">4º</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        html += `</div></div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
}

function renderSelectedResults() {
    const containers = {
        razas: document.getElementById('razasContainer'),
        grupos: document.getElementById('gruposContainer'),
        bis: document.getElementById('bisContainer')
    };

    Object.keys(containers).forEach(key => {
        if (containers[key]) {
            containers[key].innerHTML = "";
            const section = containers[key].closest('section');
            if (section) section.style.display = "none";
        }
    });

    if (!STATE.selectedResultView) return;

    const activeContainer = containers[STATE.selectedResultView];
    if (activeContainer) {
        const section = activeContainer.closest('section');
        if (section) section.style.display = "block";
        if (STATE.selectedResultView === 'razas') renderResultadosRazas();
        if (STATE.selectedResultView === 'grupos') renderResultadosGrupos();
        if (STATE.selectedResultView === 'bis') renderResultadosBis();
    }
}

function renderAll() {
    renderEventSelector();
    renderEventSummary();
    renderPistas();
    renderResultViewSelector();
    renderSelectedResults();
}

document.addEventListener('DOMContentLoaded', () => {
    loadPublicResults();
    const updateBtn = document.getElementById('updateBtn');
    if (updateBtn) updateBtn.onclick = () => loadPublicResults();
    setInterval(() => loadPublicResults(), CONFIG.AUTO_REFRESH_MS);
});
