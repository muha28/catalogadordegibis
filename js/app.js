/**
 * @file app.js
 * @description Lógica principal da PWA Minha Gibiteca. Gerencia autenticação Google via Firebase,
 * persistência em Firestore, renderização dinâmica de tabelas, coleções, filtros, ordenação e formulário unificado.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    signInWithRedirect, 
    getRedirectResult, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Verifica se está rodando em ambiente local ou de produção
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// Configurações do Firebase correspondentes ao ambiente
const firebaseConfig = isLocal 
    ? {
        apiKey: "AIzaSyArZvRam5pfYEIyrYeGFM5-VYGg0tpGJVE",
        authDomain: "gibis-da-bibi-dev.firebaseapp.com",
        projectId: "gibis-da-bibi-dev",
        storageBucket: "gibis-da-bibi-dev.firebasestorage.app",
        messagingSenderId: "491153993696",
        appId: "1:491153993696:web:486bdf96d5a8c974f88585",
        measurementId: "G-2TQPF15716"
      }
    : {
        apiKey: "AIzaSyCp1T_3QhVTTE7zd8v-X50dTpP-jHzOUek",
        authDomain: "gibis-da-bibi.firebaseapp.com",
        projectId: "gibis-da-bibi",
        storageBucket: "gibis-da-bibi.firebasestorage.app",
        messagingSenderId: "1069619452025",
        appId: "1:1069619452025:web:82d0743ae68029df595ca8"
      };

// Inicialização do Firebase e serviços de Auth/Firestore
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Garante persistência local da sessão do usuário no navegador
setPersistence(auth, browserLocalPersistence).catch(console.error);

// Chave constante que representa a visualização agregada de todas as coleções
const ALL_SHEETS_KEY = "__TODOS__";

// Estado global da aplicação
let fundosPersonagens = { "default": "" };
let colecoesFavoritas = [];
let database = {};
let currentSheet = ALL_SHEETS_KEY;
let editingId = null;
let editingOriginSheet = null;
let currentUser = null;
let isFirstLoad = true;

// Estado padrão de ordenação da tabela
let sortState = {
    column: "numero",
    direction: "asc"
};

// Mapeamentos de meses para conversão do seletor visual de Mês/Ano
const mesesMap = {
    "01": "Janeiro", "02": "Fevereiro", "03": "Março", "04": "Abril",
    "05": "Maio", "06": "Junho", "07": "Julho", "08": "Agosto",
    "09": "Setembro", "10": "Outubro", "11": "Novembro", "12": "Dezembro"
};
const mesesInverso = {
    "janeiro": "01", "fevereiro": "02", "março": "03", "marco": "03", "abril": "04",
    "maio": "05", "junho": "06", "julho": "07", "agosto": "08",
    "setembro": "09", "outubro": "10", "novembro": "11", "dezembro": "12"
};

/**
 * Converte arquivo de imagem da capa em string Base64 compactada em JPEG.
 * @param {File} file - Arquivo de imagem selecionado.
 * @param {number} maxWidth - Largura máxima permitida para otimização.
 * @returns {Promise<string>} String Base64 da imagem.
 */
function imageToBase64(file, maxWidth = 220) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve("");
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', 0.45));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

/**
 * Analisa a string de data legível (ex: "Agosto 2012") e preenche os selects de Mês e Ano.
 */
function parseDataToInputs(dataStr, mesElId, anoElId) {
    const mesEl = document.getElementById(mesElId);
    const anoEl = document.getElementById(anoElId);
    if (!mesEl || !anoEl) return;
    mesEl.value = "";
    anoEl.value = "";
    if (!dataStr) return;
    const partes = dataStr.trim().split(/\s+/);
    partes.forEach(parte => {
        const pLower = parte.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (mesesInverso[pLower]) {
            mesEl.value = mesesInverso[pLower];
        } else if (/^\d{4}$/.test(parte)) {
            anoEl.value = parte;
        }
    });
}

/**
 * Constrói a string de data a partir dos valores dos selects de mês e ano.
 */
function buildDataString(mesElId, anoElId) {
    const mesVal = document.getElementById(mesElId)?.value;
    const anoVal = document.getElementById(anoElId)?.value.trim();
    if (mesVal && anoVal) {
        return `${mesesMap[mesVal]} ${anoVal}`;
    } else if (anoVal) {
        return anoVal;
    } else if (mesVal) {
        return mesesMap[mesVal];
    }
    return "";
}

// Trata o retorno de login via redirecionamento do Google Auth
getRedirectResult(auth)
    .then((result) => {
        if (result && result.user) {
            console.log("Login via redirect concluído com sucesso:", result.user);
        }
    })
    .catch((error) => {
        console.error("Erro no retorno do redirect:", error);
    });

/**
 * Observador de estado de autenticação do Firebase.
 * Gerencia a alternância entre a tela de login e o painel principal.
 */
onAuthStateChanged(auth, async (user) => {
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    const statusEl = document.getElementById('userStatus');

    if (user) {
        currentUser = user;
        if (statusEl) statusEl.innerText = `Bem-vindo(a), Leitor(a): ${user.displayName || user.email} 🤓`;
        if (loginScreen) loginScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'block';

        await loadUserData();
        init();
    } else {
        currentUser = null;
        database = {};
        if (loginScreen) loginScreen.style.display = 'block';
        if (mainApp) mainApp.style.display = 'none';
    }
});

/**
 * Executa o fluxo de autenticação com o Google.
 */
window.loginWithGoogle = async function() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.warn("Popup falhou/bloqueado. Tentando via Redirect:", error);
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
            try {
                await signInWithRedirect(auth, provider);
            } catch (redirectError) {
                alert("Erro ao autenticar: " + redirectError.message);
            }
        } else if (error.code !== 'auth/cancelled-popup-request') {
            alert("Erro ao realizar login: " + error.message);
        }
    }
};

/**
 * Encerra a sessão atual do usuário no Firebase Auth.
 */
window.logout = function() {
    signOut(auth);
};

/**
 * Salva metadados do usuário (coleções favoritas) no Firestore.
 */
async function saveUserMeta() {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, "users", currentUser.uid), {
            fundosPersonagens: fundosPersonagens,
            colecoesFavoritas: colecoesFavoritas
        }, { merge: true });
    } catch (err) {
        console.error("Erro ao salvar metadados:", err);
    }
}

/**
 * Salva uma coleção específica e seus gibis no Firestore.
 */
async function saveSheetToFirestore(sheetName) {
    if (!currentUser || sheetName === ALL_SHEETS_KEY) return;
    try {
        const safeId = encodeURIComponent(sheetName);
        await setDoc(doc(db, "users", currentUser.uid, "colecoes", safeId), {
            nome: sheetName,
            itens: database[sheetName] || []
        });
        await saveUserMeta();
    } catch (err) {
        console.error(`Erro ao salvar coleção ${sheetName}:`, err);
        alert("Erro ao salvar alterações no Firebase.");
    }
}

/**
 * Remove uma coleção do Firestore.
 */
async function deleteSheetFromFirestore(sheetName) {
    if (!currentUser) return;
    try {
        const safeId = encodeURIComponent(sheetName);
        await deleteDoc(doc(db, "users", currentUser.uid, "colecoes", safeId));
    } catch (err) {
        console.error(`Erro ao excluir coleção ${sheetName} do Firestore:`, err);
    }
}

/**
 * Carrega todos os dados do usuário a partir do Firestore.
 */
async function loadUserData() {
    try {
        database = {};
        fundosPersonagens = { "default": "" };
        colecoesFavoritas = [];

        const userDocRef = doc(db, "users", currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            fundosPersonagens = userData.fundosPersonagens || { "default": "" };
            colecoesFavoritas = Array.isArray(userData.colecoesFavoritas) ? userData.colecoesFavoritas : [];
        }

        const colecoesRef = collection(db, "users", currentUser.uid, "colecoes");
        const querySnapshot = await getDocs(colecoesRef);

        if (!querySnapshot.empty) {
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (data.nome && Array.isArray(data.itens)) {
                    data.itens.forEach(gibi => {
                        if (!gibi.id) {
                            gibi.id = '_' + Math.random().toString(36).substr(2, 9);
                        }
                        gibi.lido = Boolean(gibi.lido);
                        gibi.favorito = Boolean(gibi.favorito);
                        if (!gibi.universo || gibi.universo.trim() === "" || gibi.universo === "Nacional") {
                            gibi.universo = "Mauricio de Sousa";
                        }
                    });
                    database[data.nome] = data.itens;
                }
            });
        }

        if (Object.keys(database).length === 0) {
            database["Chico Bento"] = [];
            await saveSheetToFirestore("Chico Bento");
        }

    } catch (err) {
        console.error("Erro ao carregar dados:", err);
        database = { "Chico Bento": [] };
    }
}

/**
 * Persiste dados de uma coleção ativa no Firestore.
 */
async function saveData(sheetName = currentSheet) {
    if (sheetName && sheetName !== ALL_SHEETS_KEY) {
        await saveSheetToFirestore(sheetName);
    }
}

/**
 * Inicializa ou reinicializa a interface e estados da aplicação.
 */
function init() { 
    if (isFirstLoad) {
        if (!sessionStorage.getItem('app_started')) {
            currentSheet = ALL_SHEETS_KEY;
            sessionStorage.setItem('app_started', 'true');
        }
        isFirstLoad = false;
    }

    const sheets = Object.keys(database);
    if (sheets.length === 0) {
        database["Minha Coleção"] = [];
        currentSheet = "Minha Coleção";
        saveData(currentSheet);
    } else if (currentSheet !== ALL_SHEETS_KEY && !database[currentSheet]) {
        currentSheet = ALL_SHEETS_KEY;
    }

    editingId = null;
    editingOriginSheet = null;
    updateSheetDropdown(); 
    updateFilterOptions();
    updateFormDatalists();
    updateSortIcons();
    renderTable(); 
}

/**
 * Atualiza os seletores de coleções (topo e campo "Salvar em:" do formulário).
 */
function updateSheetDropdown() {
    const select = document.getElementById('sheetSelect');
    const formSheetSelect = document.getElementById('selectSheet');
    const btnDeleteSheet = document.getElementById('btnDeleteSheet');
    const btnFavCollection = document.getElementById('btnFavCollection');
    if (!select) return;

    select.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = ALL_SHEETS_KEY;
    allOption.textContent = "🌟 Todas as Coleções";
    if (currentSheet === ALL_SHEETS_KEY) allOption.selected = true;
    select.appendChild(allOption);

    const sortedSheets = Object.keys(database).sort((a, b) => {
        const aFav = colecoesFavoritas.includes(a);
        const bFav = colecoesFavoritas.includes(b);
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    });

    sortedSheets.forEach(sheet => {
        const option = document.createElement('option');
        option.value = sheet; 
        const isFav = colecoesFavoritas.includes(sheet);
        option.textContent = isFav ? `⭐ ${sheet}` : sheet;
        if (sheet === currentSheet) option.selected = true;
        select.appendChild(option);
    });

    // Configura o campo "Salvar em:" do formulário com base na visualização atual
    if (formSheetSelect) {
        formSheetSelect.innerHTML = '';
        if (currentSheet === ALL_SHEETS_KEY) {
            // Se estiver em "Todas as Coleções", libera o select com todas as opções
            formSheetSelect.disabled = false;
            sortedSheets.forEach(sheet => {
                const opt = document.createElement('option');
                opt.value = sheet;
                opt.textContent = sheet;
                formSheetSelect.appendChild(opt);
            });
        } else {
            // Se estiver em uma coleção específica, trava o select apenas com ela
            formSheetSelect.disabled = true;
            const opt = document.createElement('option');
            opt.value = currentSheet;
            opt.textContent = currentSheet;
            opt.selected = true;
            formSheetSelect.appendChild(opt);
        }
    }

    if (btnFavCollection) {
        if (currentSheet === ALL_SHEETS_KEY) {
            btnFavCollection.style.display = 'none';
        } else {
            btnFavCollection.style.display = 'inline-block';
            const isCurrentFav = colecoesFavoritas.includes(currentSheet);
            btnFavCollection.textContent = isCurrentFav ? '★' : '☆';
            btnFavCollection.className = `btn-fav-star collection-star-btn ${isCurrentFav ? 'is-fav' : ''}`;
            btnFavCollection.title = isCurrentFav ? 'Remover coleção dos favoritos' : 'Favoritar esta coleção';
        }
    }

    if (btnDeleteSheet) {
        btnDeleteSheet.style.display = currentSheet === ALL_SHEETS_KEY ? 'none' : 'inline-block';
    }

    const titleEl = document.getElementById('currentSheetTitle');
    if (titleEl) {
        const isFavTitle = currentSheet !== ALL_SHEETS_KEY && colecoesFavoritas.includes(currentSheet);
        titleEl.innerHTML = currentSheet === ALL_SHEETS_KEY
            ? "COLEÇÃO: TODAS AS COLEÇÕES"
            : `COLEÇÃO: ${currentSheet.toUpperCase()} ${isFavTitle ? '⭐' : ''}`;
    }
}

/**
 * Atualiza os datalists para autocomplete nos inputs do formulário.
 */
function updateFormDatalists() {
    const universesList = document.getElementById('listUniversos');
    const editorasList = document.getElementById('listEditoras');
    const categoriasList = document.getElementById('listCategorias');
    const seriesList = document.getElementById('listSeries');

    const defaultUniverses = ["Mauricio de Sousa", "Marvel", "DC", "Disney"];
    const defaultEditors = ["Abril", "Globo", "Panini", "Culturama"];
    const defaultCategories = ["Almanaque", "Gibi Mensal", "Edição Especial"];
    const defaultSeries = ["1ª Série", "2ª Série", "3ª Série"];

    let existingUniverses = [];
    let existingEditors = [];
    let existingCategories = [];
    let existingSeries = [];

    Object.values(database).forEach(arr => {
        if (Array.isArray(arr)) {
            arr.forEach(item => {
                if (item.universo) existingUniverses.push(item.universo.trim());
                if (item.editora) existingEditors.push(item.editora.trim());
                if (item.categoria) existingCategories.push(item.categoria.trim());
                if (item.serie) existingSeries.push(item.serie.trim());
            });
        }
    });

    const populateList = (element, defaults, existing) => {
        if (!element) return;
        const allValues = [...new Set([...defaults, ...existing])]
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
        
        element.innerHTML = '';
        allValues.forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            element.appendChild(opt);
        });
    };

    populateList(universesList, defaultUniverses, existingUniverses);
    populateList(editorasList, defaultEditors, existingEditors);
    populateList(categoriasList, defaultCategories, existingCategories);
    populateList(seriesList, defaultSeries, existingSeries);
}

/**
 * Alterna o status de favorito da coleção ativa.
 */
window.toggleCurrentSheetFavorite = async function() {
    if (currentSheet === ALL_SHEETS_KEY) return;
    const index = colecoesFavoritas.indexOf(currentSheet);
    if (index > -1) {
        colecoesFavoritas.splice(index, 1);
    } else {
        colecoesFavoritas.push(currentSheet);
    }
    await saveUserMeta();
    updateSheetDropdown();
    renderTable();
};

/**
 * Atualiza os filtros de listagem na barra de ferramentas.
 */
function updateFilterOptions() {
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        const selectedCat = categoryFilter.value;
        categoryFilter.innerHTML = '<option value="TODAS">Todas as Categorias</option>';
        let itemsSource = [];
        if (currentSheet === ALL_SHEETS_KEY) {
            Object.values(database).forEach(arr => { if (Array.isArray(arr)) itemsSource.push(...arr); });
        } else if (database[currentSheet]) {
            itemsSource = database[currentSheet];
        }
        const categorias = [...new Set(itemsSource.map(i => i.categoria ? i.categoria.trim() : ""))]
            .filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
        categorias.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat; opt.textContent = cat;
            categoryFilter.appendChild(opt);
        });
        categoryFilter.value = categorias.includes(selectedCat) ? selectedCat : "TODAS";
    }

    const universeFilter = document.getElementById('universeFilter');
    if (universeFilter) {
        const selectedUniv = universeFilter.value;
        universeFilter.innerHTML = '<option value="TODOS">Todos os Universos</option>';
        let itemsSource = [];
        if (currentSheet === ALL_SHEETS_KEY) {
            Object.values(database).forEach(arr => { if (Array.isArray(arr)) itemsSource.push(...arr); });
        } else if (database[currentSheet]) {
            itemsSource = database[currentSheet];
        }
        const universos = [...new Set(itemsSource.map(i => i.universo ? i.universo.trim() : "Mauricio de Sousa"))]
            .filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
        universos.forEach(univ => {
            const opt = document.createElement('option');
            opt.value = univ; opt.textContent = univ;
            universeFilter.appendChild(opt);
        });
        universeFilter.value = universos.includes(selectedUniv) ? selectedUniv : "TODOS";
    }
}

/**
 * Cria uma nova coleção.
 */
window.createNewSheet = async function() {
    const name = prompt("Nome da Coleção:");
    if (name && name.trim() !== "") {
        const cleanName = name.trim();
        if (!database[cleanName]) {
            database[cleanName] = []; 
            currentSheet = cleanName;
            await saveData(cleanName); 
            init();
        } else { 
            alert("Esta coleção já existe!"); 
        }
    }
};

/**
 * Exclui a coleção ativa.
 */
window.deleteCurrentSheet = async function() {
    if (currentSheet === ALL_SHEETS_KEY) return;
    if (confirm(`Tem certeza que deseja excluir a coleção "${currentSheet}"?`)) {
        const sheetToDelete = currentSheet;
        delete database[sheetToDelete];
        delete fundosPersonagens[sheetToDelete];
        
        const favIdx = colecoesFavoritas.indexOf(sheetToDelete);
        if (favIdx > -1) colecoesFavoritas.splice(favIdx, 1);

        await deleteSheetFromFirestore(sheetToDelete);
        await saveUserMeta();

        currentSheet = ALL_SHEETS_KEY;
        init();
    }
};

/**
 * Altera a coleção ativa pelo dropdown superior.
 */
window.changeSheet = function() { 
    currentSheet = document.getElementById('sheetSelect').value; 
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    init(); 
};

/**
 * Adiciona um novo gibi utilizando os inputs com prefixo `input...`.
 */
window.addGibi = async function(event) {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]') || event.target.querySelector('.btn-add');
    if (submitBtn && submitBtn.disabled) return;

    const targetSheet = currentSheet === ALL_SHEETS_KEY
        ? document.getElementById('selectSheet')?.value
        : currentSheet;

    if (!targetSheet) {
        alert("Selecione ou crie uma coleção primeiro.");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalHtml = submitBtn.innerHTML;
        submitBtn.innerHTML = `<span class="spinner"></span> Adicionando...`;
    }

    try {
        const fileInput = document.getElementById('capaInput');
        const lidoInput = document.getElementById('lidoInput');
        const favoritoInput = document.getElementById('favoritoInput');
        let capaURL = "";

        if (fileInput && fileInput.files && fileInput.files[0]) {
            capaURL = await imageToBase64(fileInput.files[0]);
        }

        if (!database[targetSheet]) {
            database[targetSheet] = [];
        }

        const universoInput = document.getElementById('inputUniverso').value.trim();
        const editoraInput = document.getElementById('inputEditora').value.trim();
        const categoriaInput = document.getElementById('inputCategoria').value.trim();
        const serieInput = document.getElementById('inputSerie').value.trim();
        const dataFormatada = buildDataString('inputMes', 'inputAno');

        database[targetSheet].push({
            id: '_' + Math.random().toString(36).substr(2, 9),
            lido: lidoInput ? lidoInput.checked : false,
            favorito: favoritoInput ? favoritoInput.checked : false,
            capa: capaURL,
            universo: universoInput !== "" ? universoInput : "Mauricio de Sousa",
            editora: editoraInput,
            categoria: categoriaInput,
            serie: serieInput,
            numero: parseInt(document.getElementById('inputNumero').value) || 0,
            data: dataFormatada,
            estado: document.getElementById('inputEstado').value.trim()
        });

        await saveData(targetSheet);
        updateFilterOptions();
        updateFormDatalists();
        renderTable(); 
        document.getElementById('addGibiForm').reset();
    } catch (err) {
        console.error("Erro ao adicionar gibi:", err);
        alert("Erro ao adicionar o gibi. Verifique o console.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = submitBtn.dataset.originalHtml || '+ Adicionar À Lista';
        }
    }
};

window.toggleLidoInSheet = async function(sheetName, gibiId, isChecked) {
    const targetSheet = sheetName || currentSheet;
    if (!database[targetSheet]) return;
    const item = database[targetSheet].find(g => g.id === gibiId);
    if (!item) return;
    item.lido = Boolean(isChecked);
    renderTable();
    await saveData(targetSheet);
};

window.toggleFavoritoInSheet = async function(sheetName, gibiId) {
    const targetSheet = sheetName || currentSheet;
    if (!database[targetSheet]) return;
    const item = database[targetSheet].find(g => g.id === gibiId);
    if (!item) return;
    item.favorito = !item.favorito;
    renderTable();
    await saveData(targetSheet);
};

/**
 * Duplica os dados de um gibi para novo cadastro.
 */
window.duplicateGibi = function(sheetName, gibiId) {
    const targetSheet = sheetName || currentSheet;
    const item = database[targetSheet]?.find(g => g.id === gibiId);
    if (!item) return;

    if (currentSheet === ALL_SHEETS_KEY) {
        const selectSheet = document.getElementById('selectSheet');
        if (selectSheet) selectSheet.value = targetSheet;
    } else if (currentSheet !== targetSheet) {
        currentSheet = targetSheet;
        const select = document.getElementById('sheetSelect');
        if (select) select.value = targetSheet;
        updateFilterOptions();
    }

    document.getElementById('inputUniverso').value = item.universo || 'Mauricio de Sousa';
    document.getElementById('inputEditora').value = item.editora || '';
    document.getElementById('inputCategoria').value = item.categoria || '';
    document.getElementById('inputSerie').value = item.serie || '';
    document.getElementById('inputNumero').value = '';
    parseDataToInputs(item.data || '', 'inputMes', 'inputAno');
    document.getElementById('inputEstado').value = item.estado || '';
    document.getElementById('lidoInput').checked = false;
    document.getElementById('favoritoInput').checked = Boolean(item.favorito);

    document.getElementById('addGibiForm').scrollIntoView({ behavior: 'smooth' });
    document.getElementById('inputNumero').focus();
};

window.cancelEdit = function() { 
    editingId = null;
    editingOriginSheet = null;
    renderTable(); 
};

window.saveEdit = async function(sheetName, gibiId) {
    const targetSheet = sheetName || currentSheet;
    const itemIndex = database[targetSheet].findIndex(item => item.id === gibiId);

    if (itemIndex === -1) {
        alert("Erro: Gibi não encontrado para edição.");
        return;
    }

    const fileInput = document.getElementById(`editCapa_${gibiId}`);
    const editLidoEl = document.getElementById(`editLido_${gibiId}`);
    const editFavEl = document.getElementById(`editFav_${gibiId}`);
    let capaURL = database[targetSheet][itemIndex].capa || "";

    if (fileInput && fileInput.files && fileInput.files[0]) {
        try {
            capaURL = await imageToBase64(fileInput.files[0]);
        } catch (err) {
            console.error("Erro ao converter nova capa na edição:", err);
        }
    }

    const newUniv = document.getElementById(`editUniverso_${gibiId}`).value.trim();
    const newEd = document.getElementById(`editEditora_${gibiId}`).value.trim();
    const newCat = document.getElementById(`editCategoria_${gibiId}`).value.trim();
    const newSer = document.getElementById(`editSerie_${gibiId}`).value.trim();
    const newData = buildDataString(`editMes_${gibiId}`, `editAno_${gibiId}`);

    database[targetSheet][itemIndex] = {
        id: gibiId,
        lido: editLidoEl ? editLidoEl.checked : Boolean(database[targetSheet][itemIndex].lido),
        favorito: editFavEl ? editFavEl.checked : Boolean(database[targetSheet][itemIndex].favorito),
        capa: capaURL,
        universo: newUniv !== "" ? newUniv : "Mauricio de Sousa",
        editora: newEd,
        categoria: newCat,
        serie: newSer,
        numero: parseInt(document.getElementById(`editNumero_${gibiId}`).value) || 0,
        data: newData,
        estado: document.getElementById(`editEstado_${gibiId}`).value.trim()
    };

    editingId = null;
    editingOriginSheet = null;
    await saveData(targetSheet);
    updateFilterOptions();
    updateFormDatalists();
    renderTable();
};

window.openImageModal = function(src) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('imgModalTarget');
    if (modal && modalImg) {
        modal.style.display = 'flex';
        modalImg.src = src;
    }
};

window.closeImageModal = function() {
    const modal = document.getElementById('imageModal');
    if (modal) modal.style.display = 'none';
};

window.startEditInSheet = function(sheetName, gibiId) {
    editingId = gibiId;
    editingOriginSheet = sheetName;
    renderTable();
};

window.deleteGibiInSheet = async function(sheetName, index) {
    if (confirm(`Remover este gibi da coleção "${sheetName}"?`)) { 
        database[sheetName].splice(index, 1); 
        editingId = null;
        editingOriginSheet = null;
        await saveData(sheetName); 
        updateFilterOptions();
        updateFormDatalists();
        renderTable(); 
    }
};

window.setSort = function(column) {
    if (sortState.column === column) {
        sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
    } else {
        sortState.column = column;
        sortState.direction = column === "status" ? "desc" : "asc";
    }
    updateSortIcons();
    renderTable();
};

function updateSortIcons() {
    const cols = ["status", "colecao", "universo", "numero", "editora", "categoria", "serie", "data", "estado"];
    cols.forEach(col => {
        const iconEl = document.getElementById(`sortIcon_${col}`);
        if (iconEl) {
            if (sortState.column === col) {
                iconEl.textContent = sortState.direction === "asc" ? "▲" : "▼";
            } else {
                iconEl.textContent = "";
            }
        }
    });
}

function sortItems(items) {
    const dir = sortState.direction === "asc" ? 1 : -1;
    const col = sortState.column;

    return items.sort((a, b) => {
        if (col === "numero") {
            return ((a.numero || 0) - (b.numero || 0)) * dir;
        }
        if (col === "status") {
            const scoreA = (a.favorito ? 2 : 0) + (a.lido ? 1 : 0);
            const scoreB = (b.favorito ? 2 : 0) + (b.lido ? 1 : 0);
            if (scoreA !== scoreB) return (scoreA - scoreB) * dir;
            return (a.numero || 0) - (b.numero || 0);
        }
        if (col === "colecao") {
            const cmp = (a._originSheet || "").localeCompare(b._originSheet || "", 'pt-BR', { sensitivity: 'base' });
            return cmp !== 0 ? cmp * dir : (a.numero || 0) - (b.numero || 0);
        }
        const valA = (a[col] || "").toString();
        const valB = (b[col] || "").toString();
        const cmp = valA.localeCompare(valB, 'pt-BR', { sensitivity: 'base', numeric: true });
        return cmp !== 0 ? cmp * dir : (a.numero || 0) - (b.numero || 0);
    });
}

function updateCounters(renderedCount = 0, isGlobal = false, filteredItems = []) {
    const isAllSheets = currentSheet === ALL_SHEETS_KEY;

    let baseList = [];
    if (isAllSheets) {
        Object.values(database).forEach(arr => {
            if (Array.isArray(arr)) baseList.push(...arr);
        });
    } else {
        baseList = database[currentSheet] || [];
    }

    const totalBase = baseList.length;
    const totalAllSheets = Object.values(database).reduce((acc, sheet) => acc + (Array.isArray(sheet) ? sheet.length : 0), 0);

    const listCounterEl = document.getElementById('counterCurrentSheet');
    if (listCounterEl) {
        if (isGlobal || isAllSheets) {
            listCounterEl.innerText = `Exibindo: ${renderedCount} de ${totalBase}`;
        } else {
            listCounterEl.innerText = `Gibis nesta coleção: ${renderedCount} (de ${totalBase})`;
        }
    }

    const readCounterEl = document.getElementById('counterReadSheet');
    if (readCounterEl) {
        const readTargetCount = filteredItems.filter(item => item.lido).length;
        const totalTargetCount = renderedCount;
        const percent = totalTargetCount > 0 ? Math.round((readTargetCount / totalTargetCount) * 100) : 0;
        readCounterEl.innerText = `Lidos: ${readTargetCount}/${totalTargetCount} (${percent}%)`;
    }

    const favCounterEl = document.getElementById('counterFavSheet');
    if (favCounterEl) {
        const favCount = filteredItems.filter(item => item.favorito).length;
        favCounterEl.innerText = `⭐ Favoritos: ${favCount}`;
    }

    const totalCounterEl = document.getElementById('counterTotal');
    if (totalCounterEl) {
        totalCounterEl.innerText = `Total Geral de Gibis: ${totalAllSheets}`;
    }
}

window.renderTable = function() {
    const tbody = document.getElementById('tableBody'); 
    if (!tbody) return;

    const selectedCategory = document.getElementById('categoryFilter') ? document.getElementById('categoryFilter').value : "TODAS";
    const selectedUniverse = document.getElementById('universeFilter') ? document.getElementById('universeFilter').value : "TODOS";
    const selectedReadFilter = document.getElementById('readFilter') ? document.getElementById('readFilter').value : "TODOS";
    const selectedFavFilter = document.getElementById('favFilter') ? document.getElementById('favFilter').value : "TODOS";
    const searchInput = document.getElementById('searchInput');
    const rawSearch = searchInput ? searchInput.value.trim() : "";

    tbody.innerHTML = '';

    let itemsToRender = [];
    const isGlobalSearch = rawSearch !== "";
    const isAllSheets = currentSheet === ALL_SHEETS_KEY;

    const normalizeStr = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    const matchesFilters = (item) => {
        const itemUniv = item.universo || "Mauricio de Sousa";
        const matchesUniverse = selectedUniverse === "TODOS" || itemUniv.trim() === selectedUniverse;
        const matchesCategory = selectedCategory === "TODAS" || (item.categoria && item.categoria.trim() === selectedCategory);
        const matchesRead = selectedReadFilter === "LIDOS" ? Boolean(item.lido)
            : selectedReadFilter === "NAO_LIDOS" ? !item.lido
            : true;
        const matchesFav = selectedFavFilter === "FAVORITOS" ? Boolean(item.favorito) : true;
        return matchesUniverse && matchesCategory && matchesRead && matchesFav;
    };

    if (isGlobalSearch || isAllSheets) {
        const terms = isGlobalSearch ? rawSearch.split(/\s+/).filter(Boolean).map(normalizeStr) : [];

        Object.keys(database).forEach(sheetName => {
            const sheetItems = database[sheetName];
            if (Array.isArray(sheetItems)) {
                sheetItems.forEach(item => {
                    let matchesSearch = true;
                    if (terms.length > 0) {
                        const rawContent = [
                            sheetName,
                            item.universo || "Mauricio de Sousa",
                            item.editora || "",
                            item.categoria || "",
                            item.serie || "",
                            item.numero !== undefined && item.numero !== null ? item.numero.toString() : "",
                            item.data || "",
                            item.estado || ""
                        ].join(" ");
                        const itemContent = normalizeStr(rawContent);
                        matchesSearch = terms.every(term => itemContent.includes(term));
                    }

                    if (matchesSearch && matchesFilters(item)) {
                        itemsToRender.push({ ...item, _originSheet: sheetName });
                    }
                });
            }
        });
    } else {
        if (!database[currentSheet]) {
            updateCounters(0, false, []);
            return;
        }

        const currentItems = database[currentSheet].filter(matchesFilters);
        itemsToRender = currentItems.map(item => ({ ...item, _originSheet: currentSheet }));
    }

    itemsToRender = sortItems(itemsToRender);

    itemsToRender.forEach((item) => {
        const originSheet = item._originSheet;
        const indexNoBanco = database[originSheet].findIndex(dbItem => dbItem.id === item.id);
        const tr = document.createElement('tr');
        if (item.lido) tr.classList.add('gibi-lido');

        if (!item.id) {
            item.id = '_' + Math.random().toString(36).substr(2, 9);
        }

        if (editingId === item.id && editingOriginSheet === originSheet) {
            tr.innerHTML = `
                <td class="status-cell">
                    <div class="status-controls">
                        <input type="checkbox" class="read-checkbox" id="editLido_${item.id}" ${item.lido ? 'checked' : ''} title="Lido">
                        <input type="checkbox" id="editFav_${item.id}" ${item.favorito ? 'checked' : ''} title="Favorito" style="accent-color:#f59e0b; width:18px; height:18px; cursor:pointer;">
                    </div>
                </td>
                <td class="capa-cell"><input type="file" id="editCapa_${item.id}" accept="image/*" style="font-size:10px; width:70px;"></td>
                <td><strong>${originSheet}</strong></td>
                <td><input type="text" id="editUniverso_${item.id}" list="listUniversos"></td>
                <td><input type="number" id="editNumero_${item.id}"></td>
                <td><input type="text" id="editEditora_${item.id}" list="listEditoras"></td>
                <td><input type="text" id="editCategoria_${item.id}" list="listCategorias"></td>
                <td><input type="text" id="editSerie_${item.id}" list="listSeries"></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <select id="editMes_${item.id}" style="font-size:11px; padding:2px;">
                            <option value="">Mês</option>
                            <option value="01">Jan</option><option value="02">Fev</option><option value="03">Mar</option><option value="04">Abr</option>
                            <option value="05">Mai</option><option value="06">Jun</option><option value="07">Jul</option><option value="08">Ago</option>
                            <option value="09">Set</option><option value="10">Out</option><option value="11">Nov</option><option value="12">Dez</option>
                        </select>
                        <input type="number" id="editAno_${item.id}" placeholder="Ano" style="font-size:11px; padding:2px; width:60px;">
                    </div>
                </td>
                <td><input type="text" id="editEstado_${item.id}"></td>
                <td class="actions-cell no-pdf">
                    <button class="btn-save" onclick="saveEdit('${originSheet}', '${item.id}')">Salvar</button>
                    <button class="btn-cancel" onclick="cancelEdit()">X</button>
                </td>
            `;

            setTimeout(() => {
                const elUniv = tr.querySelector(`#editUniverso_${item.id}`);
                const elEd = tr.querySelector(`#editEditora_${item.id}`);
                const elCat = tr.querySelector(`#editCategoria_${item.id}`);
                const elSer = tr.querySelector(`#editSerie_${item.id}`);
                const elNum = tr.querySelector(`#editNumero_${item.id}`);
                const elEst = tr.querySelector(`#editEstado_${item.id}`);

                if (elUniv) elUniv.value = item.universo || 'Mauricio de Sousa';
                if (elEd) elEd.value = item.editora || '';
                if (elCat) elCat.value = item.categoria || '';
                if (elSer) elSer.value = item.serie || '';
                if (elNum) elNum.value = item.numero;
                parseDataToInputs(item.data || '', `editMes_${item.id}`, `editAno_${item.id}`);
                if (elEst) elEst.value = item.estado || '';
            }, 0);

        } else {
            const tdStatus = document.createElement('td');
            tdStatus.className = 'status-cell';
            const statusWrapper = document.createElement('div');
            statusWrapper.className = 'status-controls';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'read-checkbox';
            checkbox.checked = Boolean(item.lido);
            checkbox.title = item.lido ? 'Marcar como não lido' : 'Marcar como lido';
            checkbox.onchange = (e) => toggleLidoInSheet(originSheet, item.id, e.target.checked);

            const favBtn = document.createElement('button');
            favBtn.type = 'button';
            favBtn.className = `btn-fav-star ${item.favorito ? 'is-fav' : ''}`;
            favBtn.textContent = item.favorito ? '★' : '☆';
            favBtn.title = item.favorito ? 'Remover dos favoritos' : 'Marcar como favorito';
            favBtn.onclick = () => toggleFavoritoInSheet(originSheet, item.id);

            statusWrapper.appendChild(checkbox);
            statusWrapper.appendChild(favBtn);
            tdStatus.appendChild(statusWrapper);

            const tdCapa = document.createElement('td');
            tdCapa.className = 'capa-cell';

            if (item.capa) {
                const img = document.createElement('img');
                img.src = item.capa;
                img.className = 'capa-thumb';
                img.alt = `Capa Nº ${item.numero}`;
                img.title = 'Clique para ampliar';
                img.onclick = () => openImageModal(item.capa);
                tdCapa.appendChild(img);
            } else {
                const div = document.createElement('div');
                div.className = 'capa-placeholder';
                div.textContent = 'Sem capa';
                tdCapa.appendChild(div);
            }

            const tdPersonagem = document.createElement('td');
            tdPersonagem.innerHTML = `<strong>${originSheet}</strong>`;

            const tdUniverso = document.createElement('td');
            tdUniverso.textContent = item.universo || 'Mauricio de Sousa';

            const tdNumero = document.createElement('td');
            tdNumero.className = 'numero-cell';
            tdNumero.textContent = `Nº ${item.numero}`;

            const tdEditora = document.createElement('td');
            tdEditora.textContent = item.editora || '';

            const tdCategoria = document.createElement('td');
            tdCategoria.textContent = item.categoria || '';

            const tdSerie = document.createElement('td');
            tdSerie.textContent = item.serie || '';

            const tdData = document.createElement('td');
            tdData.textContent = item.data || '';

            const tdEstado = document.createElement('td');
            tdEstado.textContent = item.estado || '';

            const tdActions = document.createElement('td');
            tdActions.className = 'actions-cell no-pdf';
            tdActions.innerHTML = `
                <button class="btn-duplicate" onclick="duplicateGibi('${originSheet}', '${item.id}')" title="Duplicar dados para novo cadastro">Dup</button>
                <button class="btn-edit" onclick="startEditInSheet('${originSheet}', '${item.id}')">Editar</button>
                <button class="btn-delete" onclick="deleteGibiInSheet('${originSheet}', ${indexNoBanco})">Excluir</button>
            `;

            tr.appendChild(tdStatus);
            tr.appendChild(tdCapa);
            tr.appendChild(tdPersonagem);
            tr.appendChild(tdUniverso);
            tr.appendChild(tdNumero);
            tr.appendChild(tdEditora);
            tr.appendChild(tdCategoria);
            tr.appendChild(tdSerie);
            tr.appendChild(tdData);
            tr.appendChild(tdEstado);
            tr.appendChild(tdActions);
        }

        tbody.appendChild(tr);
    });

    updateCounters(itemsToRender.length, isGlobalSearch, itemsToRender);
};

window.exportarBackup = function() {
    if (!database || Object.keys(database).length === 0) {
        alert("Não há dados para exportar.");
        return;
    }
    const backupData = JSON.stringify({ database, fundosPersonagens, colecoesFavoritas }, null, 2);
    const blob = new Blob([backupData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = url;
    downloadAnchor.download = `backup_completo_catalogador_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
};

window.importarBackup = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data && data.database) {
                database = data.database;
                Object.keys(database).forEach(sheet => {
                    if (Array.isArray(database[sheet])) {
                        database[sheet].forEach(gibi => {
                            gibi.lido = Boolean(gibi.lido);
                            gibi.favorito = Boolean(gibi.favorito);
                            if (!gibi.universo || gibi.universo === "Nacional") gibi.universo = "Mauricio de Sousa";
                        });
                    }
                });
                if (data.fundosPersonagens) fundosPersonagens = data.fundosPersonagens;
                if (Array.isArray(data.colecoesFavoritas)) colecoesFavoritas = data.colecoesFavoritas;
                for (const sheetName of Object.keys(database)) {
                    await saveData(sheetName);
                }
                await saveUserMeta();
                currentSheet = ALL_SHEETS_KEY;
                init();
                alert("Backup de TODAS as coleções foi restaurado com sucesso!");
            } else {
                alert("Arquivo de backup inválido.");
            }
        } catch (err) {
            console.error(err);
            alert("Erro ao ler o arquivo de backup.");
        }
    };
    reader.readAsText(file);
};

window.exportToPDF = function() {
    const element = document.getElementById('pdfContent');
    const actionCols = document.querySelectorAll('.no-pdf');
    actionCols.forEach(el => el.style.display = 'none');
    const pdfName = currentSheet === ALL_SHEETS_KEY ? "Todas_As_Colecoes" : `Colecao_${currentSheet}`;
    const opt = { 
        margin: 8, 
        filename: `${pdfName}.pdf`, 
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };
    if (window.html2pdf) {
        window.html2pdf().set(opt).from(element).save().then(() => { 
            actionCols.forEach(el => el.style.display = ''); 
        });
    } else {
        alert("A biblioteca html2pdf não foi encontrada na página.");
        actionCols.forEach(el => el.style.display = '');
    }
};

window.toggleDarkMode = function() {
    const root = document.documentElement;
    if (root.classList.contains('dark-mode')) {
        root.classList.remove('dark-mode');
        root.classList.add('light-mode');
        localStorage.setItem('theme', 'light');
    } else {
        root.classList.remove('light-mode');
        root.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
    }
};

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.classList.add(savedTheme + '-mode');
    }
});