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
    selectedPublicView: "resultados",
    catalogSortMode: "grupo_raza_categoria",
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
    let s = String(gr).trim().toUpperCase();
    if (s.startsWith("GRUPO ")) s = s.replace("GRUPO ", "G");
    if (s.startsWith("GRUPO")) s = s.replace("GRUPO", "G");
    return s.startsWith("G") ? s : `G${s}`;
};

const byId = (list, keyName, value) => {
    if (!list || !Array.isArray(list)) return null;
    const val = normalizeID(value);
    return list.find(item => normalizeID(item[keyName]) === val);
};

const findJudge = (juezIdOrName) => {
    if (!STATE.data?.Jueces) return null;
    const val = normalizeID(juezIdOrName);
    return STATE.data.Jueces.find(j => normalizeID(j.IDJuez) === val || normalizeID(j.NombreJuez) === val);
};

const parseGrupos = (str) => {
    const s = String(str || "").toUpperCase();
    const matches = s.match(/(?:G|GRUPO)?\s*\d+/g);
    if (!matches) return [];
    return [...new Set(matches.map(x => normalizeGrupo(x.replace(/GRUPO/i, "").trim())))];
};

const getLimitadaGroups = (judge) => {
    const directos = parseGrupos(judge?.GruposHabilitados);
    if (directos.length) return directos;

    const obs = String(judge?.Observaciones || "");
    if (/LIMITAD/i.test(obs)) return parseGrupos(obs);

    return [];
};

const isJudgeLimitada = (judge) => {
    return String(judge?.TipoJuez || "").toUpperCase() === "LIMITADA" ||
        /LIMITAD/i.test(String(judge?.Observaciones || "")) ||
        getLimitadaGroups(judge).length > 0;
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

// Category sort order for catalog
const getCategoriaOrden = (idCat) => {
    const id = normalizeID(idCat);
    if (id === 'C00') return 0;
    if (id === 'C01') return 1;
    if (id === 'C02' || id === 'C03') return 2;
    if (id === 'C04' || id === 'C05' || id === 'C06' || id === 'C07') return 3;
    if (id === 'C08') return 4;
    return 99;
};

// Canonical category label for catalog grouping
const getCategoriaLabel = (idCat) => {
    const id = normalizeID(idCat);
    if (id === 'C00') return "Cachorros Especiales";
    if (id === 'C01') return "Cachorros";
    if (id === 'C02' || id === 'C03') return "Jóvenes";
    if (id === 'C04' || id === 'C05' || id === 'C06' || id === 'C07') return "Abierta / Adultos";
    if (id === 'C08') return "Veteranos";
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

function getJudgePhotoUrl(judge) {
    const raw = String(judge?.FotoURL || "").trim();
    if (!raw) return "";

    if (raw.includes("|")) {
        return raw.split("|").pop().trim();
    }

    return raw;
}

const getFirstValue = (obj, keys) => {
    if (!obj) return "";
    for (const key of keys) {
        const value = obj[key];
        if (value !== null && value !== undefined && String(value).trim() !== "") return value;
    }
    return "";
};

const sortByNaturalText = (a, b) => String(a || "").localeCompare(String(b || ""), "es", {
    numeric: true,
    sensitivity: "base"
});

function getCatalogName(listName, idKey, nameKeys, idValue, fallback = "") {
    const item = byId(STATE.data?.[listName], idKey, idValue);
    return getFirstValue(item, nameKeys) || fallback;
}

function getDogTitles(dog) {
    const directTitles = getFirstValue(dog, ["Titulos", "Títulos", "Titulo", "Título", "TitulosDeclarados", "TitulosPrevios"]);
    if (directTitles) return directTitles;

    const idsRaw = getFirstValue(dog, ["IDTitulo", "IDTitulos", "IDTítulo", "IDTítulos"]);
    if (!idsRaw) return "";

    const titleIds = String(idsRaw).split(/[,\|;]+/).map(normalizeID).filter(Boolean);
    const titleNames = titleIds.map(id => getCatalogName(
        "Catalogo_Titulos",
        "IDTitulo",
        ["NombreTitulo", "NombreTítulo", "Titulo", "Título", "Descripcion", "Descripción"],
        id,
        ""
    )).filter(Boolean);

    return titleNames.join(", ");
}

function getNumeroCatalogoOrden(dog) {
    const numero = getFirstValue(dog, ["NumeroCatalogo", "NúmeroCatalogo", "Numero", "Número"]);
    const parsed = parseInt(String(numero).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : 999999;
}

function getNombreRaza(dog) {
    return getCatalogName(
        "Catalogo_Razas",
        "IDRaza",
        ["NombreRaza", "Raza"],
        dog?.IDRaza,
        getFirstValue(dog, ["Raza", "NombreRaza"]) || "Raza desconocida"
    );
}

function getNombreCategoria(dog) {
    const idCategoria = normalizeID(dog?.IDCategoria);
    return getCatalogName(
        "Catalogo_Categorias",
        "IDCategoria",
        ["NombreCategoria", "Categoria", "Categoría"],
        dog?.IDCategoria,
        getFirstValue(dog, ["Categoria", "Categoría"]) || getCategoriaLabel(idCategoria)
    );
}

function getNombreSexo(dog) {
    return getCatalogName(
        "Catalogo_Sexos",
        "IDSexo",
        ["NombreSexo", "Sexo"],
        dog?.IDSexo,
        getFirstValue(dog, ["Sexo"]) || "Sexo sin datos"
    );
}

function getTitulosTexto(dog) {
    return getDogTitles(dog);
}











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
                const judge = findJudge(STATE.selectedJudgeId);
                const esLimitada = isJudgeLimitada(judge);
                const availableGroups = esLimitada ? parseGrupos(judge?.GruposHabilitados) : tracks
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
    STATE.selectedPublicView = "resultados";

    const judge = findJudge(idJuez);
    const esLimitada = isJudgeLimitada(judge);
    if (esLimitada) {
        STATE.selectedGroupIds = parseGrupos(judge?.GruposHabilitados);
        STATE.selectedResultView = 'razas';
    } else {
        STATE.selectedGroupIds = [];
        STATE.selectedResultView = null;
    }
    renderAll();
};

window.selectGroupToggle = (event, idPista, idJuez, idGrupo) => {
    if (event) event.stopPropagation();

    const judge = findJudge(idJuez);
    const esLimitada = isJudgeLimitada(judge);
    const allowed = esLimitada ? parseGrupos(judge?.GruposHabilitados) : null;
    const targetGroup = normalizeGrupo(idGrupo);
    STATE.selectedPublicView = "resultados";

    if (esLimitada && !allowed.includes(targetGroup)) {
        return;
    }

    if (STATE.selectedPistaId !== normalizeID(idPista) || STATE.selectedJudgeId !== normalizeID(idJuez)) {
        STATE.selectedPistaId = normalizeID(idPista);
        STATE.selectedJudgeId = normalizeID(idJuez);
        STATE.selectedPublicView = "resultados";
        if (esLimitada) {
            STATE.selectedResultView = 'razas';
        } else {
            STATE.selectedResultView = null;
        }
        STATE.selectedGroupIds = [targetGroup];
    } else {
        const index = STATE.selectedGroupIds.indexOf(targetGroup);

        if (index === -1) {
            STATE.selectedGroupIds.push(targetGroup);
        } else {
            STATE.selectedGroupIds.splice(index, 1);
        }
    }

    if (esLimitada) {
        STATE.selectedGroupIds = STATE.selectedGroupIds.filter(g => allowed.includes(g));
    }

    renderAll();
};

window.setResultView = (viewType) => {
    STATE.selectedResultView = viewType;
    STATE.selectedPublicView = "resultados";
    renderAll();
};

window.openCatalogoInscriptos = () => {
    STATE.selectedPublicView = "catalogo";
    renderAll();
};

window.volverAResultados = () => {
    STATE.selectedPublicView = "resultados";
    renderAll();
};

window.setCatalogSortMode = (mode) => {
    STATE.catalogSortMode = mode;
    renderCatalogoInscriptos();
};

window.setCatalogoSort = window.setCatalogSortMode;

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

function renderPublicViewControls() {
    const btn = document.getElementById('catalogoBtn');
    if (!btn) return;

    btn.classList.toggle('active', STATE.selectedPublicView === "catalogo");
    btn.onclick = () => window.openCatalogoInscriptos();
}

function renderCatalogoInscriptos() {
    const container = document.getElementById('catalogoContainer');
    if (!container) return;

    const perros = (STATE.data?.Catalogo_Perros_Inscriptos || []).filter(dog =>
        normalizeID(dog.IDEvento) === STATE.selectedEventId
    );

    if (perros.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay perros inscriptos para esta exposición.</div>`;
        return;
    }

    // Build enriched items
    const catalogItems = perros.map(dog => {
        const rawGroup = getFirstValue(dog, ["IDGrupo", "Grupo"]);
        const grupoId = normalizeGrupo(rawGroup);
        const grupo = getCatalogName(
            "Catalogo_Grupos",
            "IDGrupo",
            ["NombreGrupo", "Grupo", "Descripcion", "Descripción"],
            rawGroup,
            grupoId
        );
        const raza = getNombreRaza(dog);
        const idCategoria = normalizeID(dog.IDCategoria);
        const categoria = getNombreCategoria(dog);
        const catOrden = getCategoriaOrden(idCategoria);
        const catLabel = getCategoriaLabel(idCategoria);
        const sexo = getNombreSexo(dog);
        const numero = getFirstValue(dog, ["NumeroCatalogo", "NúmeroCatalogo", "Numero", "Número"]) || "S/N";
        const numeroInt = getNumeroCatalogoOrden(dog);
        const titulos = getTitulosTexto(dog);
        const observaciones = getFirstValue(dog, [
            "Observaciones",
            "Observación",
            "Identificacion",
            "Identificación",
            "Microchip",
            "Chip",
            "Registro"
        ]);

        return { grupoId, grupo, raza, idCategoria, categoria, catOrden, catLabel, sexo, numero, numeroInt, titulos, observaciones };
    });

    const mode = STATE.catalogSortMode || "grupo_raza_categoria";

    // Sort functions per mode
    const sortFns = {
        catalogo: (a, b) => a.numeroInt - b.numeroInt,
        grupo_raza_categoria: (a, b) =>
            sortByNaturalText(a.grupoId, b.grupoId) ||
            sortByNaturalText(a.raza, b.raza) ||
            (a.catOrden - b.catOrden) ||
            sortByNaturalText(a.sexo, b.sexo) ||
            (a.numeroInt - b.numeroInt),
        grupo_categoria_raza: (a, b) =>
            sortByNaturalText(a.grupoId, b.grupoId) ||
            (a.catOrden - b.catOrden) ||
            sortByNaturalText(a.raza, b.raza) ||
            (a.numeroInt - b.numeroInt),
        raza: (a, b) =>
            sortByNaturalText(a.raza, b.raza) ||
            (a.catOrden - b.catOrden) ||
            sortByNaturalText(a.sexo, b.sexo) ||
            (a.numeroInt - b.numeroInt),
        categoria: (a, b) =>
            (a.catOrden - b.catOrden) ||
            sortByNaturalText(a.grupoId, b.grupoId) ||
            sortByNaturalText(a.raza, b.raza) ||
            (a.numeroInt - b.numeroInt)
    };

    catalogItems.sort(sortFns[mode] || sortFns.grupo_raza_categoria);

    // --- Sort button bar ---
    const sortButtons = [
        { id: "catalogo", label: "ORDEN POR CATÁLOGO" },
        { id: "grupo_raza_categoria", label: "GRUPO / RAZA / CATEGORÍA" },
        { id: "grupo_categoria_raza", label: "GRUPO / CATEGORÍA / RAZA" },
        { id: "raza", label: "RAZA" },
        { id: "categoria", label: "CATEGORÍA" }
    ];

    let html = `
            <div style="margin-bottom: 14px; display: flex; justify-content: center;">
                <button class="catalogo-sort-btn active" onclick="window.volverAResultados()">
                    ← VOLVER A RESULTADOS EN VIVO
                </button>
            </div>
            <div class="catalogo-summary">Total inscriptos: <strong>${catalogItems.length}</strong></div>
            <div class="catalogo-sort-bar">

            <span class="catalogo-sort-label">Ordenar por:</span>
            <div class="catalogo-sort-buttons">
                ${sortButtons.map(b => `
                    <button class="catalogo-sort-btn ${mode === b.id ? 'active' : ''}" onclick="window.setCatalogSortMode('${b.id}')">${b.label}</button>
                `).join('')}
            </div>
        </div>
        <div class="catalogo-list">
    `;

    // --- Render card helper ---
    const renderDogCard = (item) => `
        <div class="catalogo-dog-card">
            <div class="catalogo-dog-header">
                <span class="catalogo-number">#${item.numero}</span>
                <span class="catalogo-dog-raza">— ${item.raza}</span>
            </div>
            <div class="catalogo-dog-details">
                <span>${item.sexo}</span> · <span>${item.categoria}</span>
            </div>
            <div class="catalogo-dog-grupo">Grupo ${item.grupoId}</div>
            <div class="catalogo-dog-meta"><strong>Títulos:</strong> ${item.titulos || 'Sin datos'}</div>
            <div class="catalogo-dog-meta"><strong>Identificación:</strong> ${item.observaciones || 'Sin datos'}</div>
        </div>
    `;

    // --- Grouped rendering per mode ---
    if (mode === "catalogo") {
        // Flat list by number, no grouping
        html += `<div class="catalogo-flat-grid">`;
        catalogItems.forEach(item => { html += renderDogCard(item); });
        html += `</div>`;

    } else if (mode === "grupo_raza_categoria" || mode === "grupo_categoria_raza") {
        // Group by Grupo
        const groups = {};
        catalogItems.forEach(item => {
            if (!groups[item.grupoId]) groups[item.grupoId] = { nombre: item.grupo, items: [] };
            groups[item.grupoId].items.push(item);
        });

        Object.keys(groups).sort(sortByNaturalText).forEach(gId => {
            const g = groups[gId];
            html += `<article class="catalogo-group"><h3 class="catalogo-group-title">${g.nombre}</h3>`;

            if (mode === "grupo_raza_categoria") {
                // Sub-group by raza
                const razas = {};
                g.items.forEach(item => {
                    if (!razas[item.raza]) razas[item.raza] = [];
                    razas[item.raza].push(item);
                });
                Object.keys(razas).sort(sortByNaturalText).forEach(rz => {
                    html += `<div class="catalogo-raza-card"><h4 class="catalogo-raza-title">${rz}</h4><div class="catalogo-dogs">`;
                    razas[rz].forEach(item => { html += renderDogCard(item); });
                    html += `</div></div>`;
                });
            } else {
                // grupo_categoria_raza: sub-group by category
                const cats = {};
                g.items.forEach(item => {
                    const key = `${item.catOrden}_${item.catLabel}`;
                    if (!cats[key]) cats[key] = { label: item.catLabel, items: [] };
                    cats[key].items.push(item);
                });
                Object.keys(cats).sort().forEach(key => {
                    const cat = cats[key];
                    html += `<div class="catalogo-raza-card"><h4 class="catalogo-raza-title">${cat.label}</h4><div class="catalogo-dogs">`;
                    cat.items.forEach(item => { html += renderDogCard(item); });
                    html += `</div></div>`;
                });
            }

            html += `</article>`;
        });

    } else if (mode === "raza") {
        // Group by raza
        const razas = {};
        catalogItems.forEach(item => {
            if (!razas[item.raza]) razas[item.raza] = [];
            razas[item.raza].push(item);
        });
        Object.keys(razas).sort(sortByNaturalText).forEach(rz => {
            html += `<article class="catalogo-group"><h3 class="catalogo-group-title">${rz}</h3><div class="catalogo-dogs">`;
            razas[rz].forEach(item => { html += renderDogCard(item); });
            html += `</div></article>`;
        });

    } else if (mode === "categoria") {
        // Group by category label
        const cats = {};
        catalogItems.forEach(item => {
            const key = `${item.catOrden}_${item.catLabel}`;
            if (!cats[key]) cats[key] = { label: item.catLabel, items: [] };
            cats[key].items.push(item);
        });
        Object.keys(cats).sort().forEach(key => {
            const cat = cats[key];
            html += `<article class="catalogo-group"><h3 class="catalogo-group-title">${cat.label}</h3><div class="catalogo-dogs">`;
            cat.items.forEach(item => { html += renderDogCard(item); });
            html += `</div></article>`;
        });
    }

    html += `</div>`;
    container.innerHTML = html;
}





function renderPistas() {
    const container = document.getElementById('pistasContainer');
    if (!container) return;

    const pistas = (STATE.data?.Gestion_pistas || []).filter(p =>
        normalizeID(p.IDEvento) === STATE.selectedEventId
    );

    if (pistas.length === 0) {
        container.innerHTML = `<div class="empty-state">No hay pistas asignadas para este evento.</div>`;
        return;
    }

    const grouped = {};

    pistas.forEach(p => {
        const key = `${p.IDPista}_${p.IDJuez}`;

        if (!grouped[key]) {
            const judge = findJudge(p.IDJuez);
            const esLimitada = isJudgeLimitada(judge);
            const gruposLimitada = getLimitadaGroups(judge);

            grouped[key] = {
                idPista: normalizeID(p.IDPista),
                idJuez: normalizeID(p.IDJuez),
                juez: judge ? judge.NombreJuez : (p.IDJuez || "Juez no asignado"),
                fotoUrl: getJudgePhotoUrl(judge),
                esLimitada,
                gruposLimitada,
                grupos: new Set()
            };
        }

        if (p.IDGrupo) grouped[key].grupos.add(normalizeGrupo(p.IDGrupo));
    });

    container.innerHTML = Object.values(grouped).map(track => {
        const isTrackActive = (
            STATE.selectedPistaId === track.idPista &&
            STATE.selectedJudgeId === track.idJuez
        );

        const gruposList = track.esLimitada
            ? track.gruposLimitada
            : Array.from(track.grupos).sort();

        return `
            <div class="track-card ${track.esLimitada ? 'track-card-limitada' : ''} ${isTrackActive ? 'active' : ''}" 
                 onclick="window.selectTrack('${track.idPista}', '${track.idJuez}')">

                ${track.esLimitada ? `
                    <div class="track-card-badge-container">
                        <span class="badge-limitada limitada-badge">LIMITADA</span>
                    </div>
                ` : ''}

                <div class="track-number">Pista ${track.idPista}</div>
                <div class="track-judge">${track.juez}</div>

                ${track.esLimitada ? `
                    <div class="track-limitada-subtitle limitada-note">
                        <div style="font-weight: 800; margin-bottom: 4px;">Competencia limitada / nacional</div>
                        <div class="limitada-groups">Grupos habilitados: ${gruposList.join(', ')}</div>
                    </div>
                ` : ''}

                <div class="track-judge-photo-wrap">
                    ${track.fotoUrl
                ? `<img src="${track.fotoUrl}" alt="Foto de ${track.juez}" class="track-judge-photo" loading="lazy">`
                : `<div class="track-judge-photo-placeholder">👤</div>`
            }
                </div>

                <div class="track-groups">
                    ${gruposList.map(g => {
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
        const judge = findJudge(STATE.selectedJudgeId);
        const esLimitada = isJudgeLimitada(judge);
        if (esLimitada && STATE.selectedResultView === 'bis') {
            STATE.selectedResultView = 'razas';
        }

        const groupText = STATE.selectedGroupIds.length > 0 ? ` — ${STATE.selectedGroupIds.sort().join(', ')}` : '';
        const contextTitle = esLimitada ? 'Consultando limitada' : (STATE.selectedResultView === 'bis' ? 'Consultando BIS' : 'Consultando');

        selectorHtml = `
            <div class="result-view-selector">
                <div class="selected-context">
                    ${contextTitle}: <strong>Pista ${STATE.selectedPistaId} — ${judge ? judge.NombreJuez : ''}${groupText}</strong>
                </div>
                ${esLimitada ? `
                <div class="limitada-notice">
                    Competencia limitada / nacional. Finaliza en Mejor de Grupo y no participa en Finales BIS.
                </div>
                ` : ''}
                <div class="view-buttons">
                    ${esLimitada ? `
                    <button class="result-view-btn ${STATE.selectedResultView === 'razas' ? 'active' : ''}" 
                            onclick="window.setResultView('razas')">RESULTADOS RAZAS / LIMITADA</button>
                    <button class="result-view-btn ${STATE.selectedResultView === 'grupos' ? 'active' : ''}" 
                            onclick="window.setResultView('grupos')">MEJOR DE GRUPO / LIMITADA</button>
                    ` : `
                    <button class="result-view-btn ${STATE.selectedResultView === 'razas' ? 'active' : ''}" 
                            onclick="window.setResultView('razas')">Resultados Razas</button>
                    <button class="result-view-btn ${STATE.selectedResultView === 'grupos' ? 'active' : ''}" 
                            onclick="window.setResultView('grupos')">Final Grupo</button>
                    <button class="result-view-btn ${STATE.selectedResultView === 'bis' ? 'active' : ''}" 
                            onclick="window.setResultView('bis')">Finales BIS</button>
                    `}
                </div>
            </div>
        `;
    }

    navContainer.innerHTML = selectorHtml;
}

function renderResultadosRazas() {
    const container = document.getElementById('razasContainer');
    if (!container) return;

    const judge = findJudge(STATE.selectedJudgeId);
    const esLimitada = isJudgeLimitada(judge);
    const allowedGroups = esLimitada ? parseGrupos(judge?.GruposHabilitados) : (STATE.selectedGroupIds || []);
    const activeGroups = (STATE.selectedGroupIds || []).filter(g => allowedGroups.includes(g));

    if (activeGroups.length === 0) {
        container.innerHTML = `<div class="empty-state">Seleccioná uno o más grupos para ver resultados de razas.</div>`;
        return;
    }

    const results = (STATE.data?.Resultados_Razas || []).filter(r => {
        if (normalizeID(r.IDEvento) !== STATE.selectedEventId) return false;
        if (normalizeID(r.IDJuez) !== STATE.selectedJudgeId) return false;

        // Show if it has a placement, qualification, title OR is absent
        if (!(r.Puesto || r.Calificacion || r.Titulo_Ganado || r.Titulo || r.TituloGanado || r.Titulos || isTruthy(r.Ausente))) return false;

        const dog = byId(STATE.data?.Catalogo_Perros_Inscriptos, 'IDInscripcion', r.IDInscripcion);
        return dog && activeGroups.includes(normalizeGrupo(dog.IDGrupo));
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
                    const juezObj = byId(STATE.data?.Jueces, 'IDJuez', d.IDJuez);
                    const esLimitada = isJudgeLimitada(juezObj) || d.TipoCompetencia === "LIMITADA";
                    const tituloGanado = esLimitada ? "" : (d.Titulo_Ganado || d.Titulo || d.TituloGanado || d.Titulos || "");

                    html += `
                        <div class="result-item ${isAus ? 'ausente-item' : ''}">
                            <div class="result-info" style="width: 100%;">
                                <div class="dog-title">#${d.dog.NumeroCatalogo} — ${rz}</div>
                                <div class="dog-subtitle">${d.sexo} | ${d.catName}</div>
                                <div class="dog-meta">
                                    <strong>Identificación:</strong> ${d.dog.Observaciones || 'Sin datos'}
                                </div>
                                ${tituloGanado ? `
                                <div class="public-title-row">
                                  <span class="public-title-label">Título:</span>
                                  <span class="public-title-badge">${tituloGanado}</span>
                                </div>
                                ` : ""}
                                <div class="result-labels">
                                    ${d.Calificacion ? `<span class="label label-qualification">${d.Calificacion}</span>` : ''}
                                </div>
                                <div class="public-indicators">
                                    <div class="public-indicator-btn btn-aus ${isAus ? 'active' : ''}">AUS</div>
                                    ${["1", "2", "3", "4", "5", "6", "7"].map(pst => `
                                      <div class="public-indicator-btn btn-${pst} ${String(d.Puesto) === pst && !isAus ? 'active' : ''}">
                                        ${pst}º
                                      </div>
                                    `).join("")}
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

    const judge = findJudge(STATE.selectedJudgeId);
    const esLimitada = isJudgeLimitada(judge);
    const allowedGroups = esLimitada ? parseGrupos(judge?.GruposHabilitados) : (STATE.selectedGroupIds || []);
    const activeGroups = (STATE.selectedGroupIds || []).filter(g => allowedGroups.includes(g));

    if (activeGroups.length === 0) {
        container.innerHTML = `<div class="empty-state">Seleccioná uno o más grupos para ver los resultados oficiales.</div>`;
        return;
    }

    // 1. Get official results from Resultados_Grupos (Primary Source)
    const results = (STATE.data?.Resultados_Grupos || []).filter(r =>
        normalizeID(r.IDEvento) === STATE.selectedEventId &&
        normalizeID(r.IDJuez) === STATE.selectedJudgeId &&
        activeGroups.includes(normalizeGrupo(r.IDGrupo)) &&
        (r.PuestoGrupo || isTruthy(r.Ausente))
    );

    const resRazas = STATE.data?.Resultados_Razas || [];

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

                    const rRaza = resRazas.find(rr =>
                        normalizeID(rr.IDInscripcion) === normalizeID(item.dog.IDInscripcion) &&
                        normalizeID(rr.IDEvento) === STATE.selectedEventId &&
                        normalizeID(rr.IDJuez) === STATE.selectedJudgeId
                    );

                    const juezObj = byId(STATE.data?.Jueces, 'IDJuez', STATE.selectedJudgeId);
                    const esLimitada = isJudgeLimitada(juezObj) || rRaza?.TipoCompetencia === "LIMITADA" || item.res.TipoCompetencia === "LIMITADA";

                    const tituloGanado = esLimitada ? "" : (
                        rRaza?.Titulo_Ganado ||
                        rRaza?.Titulo ||
                        rRaza?.TituloGanado ||
                        rRaza?.Titulos ||
                        ""
                    );

                    html += `
                        <div class="result-card mini ${isAus ? 'ausente-card' : ''}">
                            <div class="result-body mini">
                                <div class="result-item mini">
                                    <div class="result-info" style="width: 100%;">
                                        <div class="dog-title mini">#${item.dog.NumeroCatalogo} — ${rz}</div>
                                        <div class="dog-subtitle">${item.dog.Observaciones || ''}</div>
                                        ${tituloGanado ? `
                                        <div class="public-title-row">
                                            <span class="public-title-label">Título:</span>
                                            <span class="public-title-badge">${tituloGanado}</span>
                                        </div>
                                        ` : ""}
                                        <div class="public-indicators">
                                            <div class="public-indicator-btn btn-aus ${isAus ? 'active' : ''}">AUS</div>
                                            ${["1", "2", "3", "4", "5", "6", "7"].map(pst => `
                                                <div class="public-indicator-btn btn-${pst} ${String(p) === pst && !isAus ? 'active' : ''}">
                                                    ${pst}º
                                                </div>
                                            `).join("")}
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

    const judge = findJudge(STATE.selectedJudgeId);
    const esLimitada = isJudgeLimitada(judge);
    if (esLimitada) {
        container.innerHTML = `<div class="limitada-notice">Esta competencia limitada no participa en Finales BIS.</div>`;
        setTimeout(() => {
            if (STATE.selectedResultView === 'bis') {
                STATE.selectedResultView = 'razas';
                renderAll();
            }
        }, 1500);
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
    const resRazas = STATE.data?.Resultados_Razas || [];

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

                const rRaza = resRazas.find(rr =>
                    normalizeID(rr.IDInscripcion) === normalizeID(item.dog.IDInscripcion) &&
                    normalizeID(rr.IDEvento) === STATE.selectedEventId &&
                    normalizeID(rr.IDJuez) === STATE.selectedJudgeId
                );

                const juezObj = byId(STATE.data?.Jueces, 'IDJuez', STATE.selectedJudgeId);
                const esLimitada = isJudgeLimitada(juezObj) || rRaza?.TipoCompetencia === "LIMITADA";

                const tituloGanado = esLimitada ? "" : (
                    rRaza?.Titulo_Ganado ||
                    rRaza?.Titulo ||
                    rRaza?.TituloGanado ||
                    rRaza?.Titulos ||
                    ""
                );

                html += `
                    <div class="result-card mini ${isAus ? 'ausente-card' : ''}">
                        <div class="result-body mini">
                            <div class="result-item mini">
                                <div class="result-info" style="width: 100%;">
                                    <div class="dog-title mini">${item.grupo} — #${item.dog.NumeroCatalogo}</div>
                                    <div class="dog-subtitle">${item.rz}</div>
                                    <div class="dog-meta mini">Cat. Orig: ${item.dog.IDCategoria} | ${item.dog.Observaciones || ''}</div>
                                    ${tituloGanado ? `
                                    <div class="public-title-row">
                                        <span class="public-title-label">Título:</span>
                                        <span class="public-title-badge">${tituloGanado}</span>
                                    </div>
                                    ` : ""}
                                    <div class="public-indicators">
                                        <div class="public-indicator-btn btn-aus ${isAus ? 'active' : ''}">AUS</div>
                                        ${["1", "2", "3", "4", "5", "6", "7"].map(pst => `
                                            <div class="public-indicator-btn btn-${pst} ${String(p) === pst && !isAus ? 'active' : ''}">
                                                ${pst}º
                                            </div>
                                        `).join("")}
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
        bis: document.getElementById('bisContainer'),
        catalogo: document.getElementById('catalogoContainer')
    };

    Object.keys(containers).forEach(key => {
        if (containers[key]) {
            containers[key].innerHTML = "";
            const section = containers[key].closest('section');
            if (section) section.style.display = "none";
        }
    });

    if (STATE.selectedPublicView === "catalogo") {
        const catalogoContainer = containers.catalogo;
        if (catalogoContainer) {
            const section = catalogoContainer.closest('section');
            if (section) section.style.display = "block";
            renderCatalogoInscriptos();
        }
        return;
    }

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
    renderPublicViewControls();
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
