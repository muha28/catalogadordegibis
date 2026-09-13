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

// Alternância automática de ambiente (Dev vs Prod)
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

const firebaseConfig = isLocal 
    ? {
        // PROJETO DE TESTES (DEV) - Suas chaves novas
        apiKey: "AIzaSyArZvRam5pfYEIyrYeGFM5-VYGg0tpGJVE",
        authDomain: "gibis-da-bibi-dev.firebaseapp.com",
        projectId: "gibis-da-bibi-dev",
        storageBucket: "gibis-da-bibi-dev.firebasestorage.app",
        messagingSenderId: "491153993696",
        appId: "1:491153993696:web:486bdf96d5a8c974f88585",
        measurementId: "G-2TQPF15716"
      }
    : {
        // PROJETO DE PRODUÇÃO (PROD) - As chaves oficiais da aplicação
        apiKey: "AIzaSyCp1T_3QhVTTE7zd8v-X50dTpP-jHzOUek",
        authDomain: "gibis-da-bibi.firebaseapp.com",
        projectId: "gibis-da-bibi",
        storageBucket: "gibis-da-bibi.firebasestorage.app",
        messagingSenderId: "1069619452025",
        appId: "1:1069619452025:web:82d0743ae68029df595ca8"
      };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Persistência local do Firebase Auth
setPersistence(auth, browserLocalPersistence).catch(console.error);

let fundosPersonagens = { "default": "" };
let database = {};
let currentSheet = "";
let editingId = null; // Alterado de editingIndex para editingId para garantir unicidade e evitar conflitos cruzados
let currentUser = null;

/**
 * Converte e comprime imagens enviadas para Base64 (otimizado)
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

// 1. Processa retorno de redirecionamentos do login do Google
getRedirectResult(auth)
    .then((result) => {
        if (result && result.user) {
            console.log("Login via redirect concluído com sucesso:", result.user);
        }
    })
    .catch((error) => {
        console.error("Erro no retorno do redirect:", error);
    });

// 2. Observador de Estado de Autenticação
onAuthStateChanged(auth, async (user) => {
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    const statusEl = document.getElementById('userStatus');

    if (user) {
        currentUser = user;
        if (statusEl) statusEl.innerText = `Usuário: ${user.displayName || user.email}`;
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

// 3. Funções Globais de Autenticação
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

window.logout = function() {
    signOut(auth);
};

// ==========================================================================
// 4. OPERAÇÕES DE BANCO DE DADOS (COM SUBDOCUMENTOS)
// ==========================================================================

async function saveUserMeta() {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, "users", currentUser.uid), {
            fundosPersonagens: fundosPersonagens
        }, { merge: true });
    } catch (err) {
        console.error("Erro ao salvar metadados:", err);
    }
}

async function saveSheetToFirestore(sheetName) {
    if (!currentUser) return;
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

async function deleteSheetFromFirestore(sheetName) {
    if (!currentUser) return;
    try {
        const safeId = encodeURIComponent(sheetName);
        await deleteDoc(doc(db, "users", currentUser.uid, "colecoes", safeId));
    } catch (err) {
        console.error(`Erro ao excluir coleção ${sheetName} do Firestore:`, err);
    }
}

async function loadUserData() {
    try {
        database = {};
        fundosPersonagens = { "default": "" };

        // Carrega apenas os metadados (como os fundos dos personagens)
        const userDocRef = doc(db, "users", currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            fundosPersonagens = userData.fundosPersonagens || { "default": "" };
        }

        // Carrega as coleções diretamente da subcoleção de forma limpa e segura
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

async function saveData(sheetName = currentSheet) {
    if (sheetName) {
        await saveSheetToFirestore(sheetName);
    }
}

// 5. Inicialização e Atualização de Interface
function init() { 
    const sheets = Object.keys(database);
    if (sheets.length === 0) {
        database["Minha Coleção"] = [];
        currentSheet = "Minha Coleção";
        saveData(currentSheet);
    } else if (!database[currentSheet]) {
        currentSheet = sheets[0];
    }
    editingId = null;
    updateSheetDropdown(); 
    updateCategoryFilterOptions();
    renderTable(); 
}

function updateSheetDropdown() {
    const select = document.getElementById('sheetSelect');
    if (!select) return;
    select.innerHTML = '';

    const sortedSheets = Object.keys(database).sort((a, b) => 
        a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    );

    sortedSheets.forEach(sheet => {
        const option = document.createElement('option');
        option.value = sheet; 
        option.textContent = sheet;
        if (sheet === currentSheet) option.selected = true;
        select.appendChild(option);
    });

    const titleEl = document.getElementById('currentSheetTitle');
    if (titleEl) titleEl.innerText = "COLEÇÃO: " + currentSheet.toUpperCase();
}

function updateCategoryFilterOptions() {
    const filterSelect = document.getElementById('categoryFilter');
    if (!filterSelect) return;

    const selectedValue = filterSelect.value;
    filterSelect.innerHTML = '<option value="TODAS">Todas as Categorias</option>';

    if (!database[currentSheet]) return;

    const categorias = [...new Set(database[currentSheet].map(item => item.categoria ? item.categoria.trim() : ""))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    categorias.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        filterSelect.appendChild(option);
    });

    filterSelect.value = categorias.includes(selectedValue) ? selectedValue : "TODAS";
}

// 6. Manipulação de Listas/Coleções
window.createNewSheet = async function() {
    const name = prompt("Nome do Personagem/Lista:");
    if (name && name.trim() !== "") {
        const cleanName = name.trim();
        if (!database[cleanName]) {
            database[cleanName] = []; 
            currentSheet = cleanName;
            await saveData(cleanName); 
            init();
        } else { 
            alert("Esta lista já existe!"); 
        }
    }
};

window.deleteCurrentSheet = async function() {
    if (confirm(`Tem certeza que deseja excluir a lista "${currentSheet}"?`)) {
        const sheetToDelete = currentSheet;
        delete database[sheetToDelete];
        delete fundosPersonagens[sheetToDelete];
        
        await deleteSheetFromFirestore(sheetToDelete);
        await saveUserMeta();

        const remaining = Object.keys(database);
        currentSheet = remaining.length > 0 ? remaining[0] : "";
        init();
    }
};

window.changeSheet = function() { 
    currentSheet = document.getElementById('sheetSelect').value; 
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    init(); 
};

// 7. Manipulação dos Items (Gibis) - COM TRAVA E SPINNER DE CARREGAMENTO
window.addGibi = async function(event) {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]') || event.target.querySelector('.btn-add');
    if (submitBtn && submitBtn.disabled) return;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalHtml = submitBtn.innerHTML;
        submitBtn.innerHTML = `<span class="spinner"></span> Adicionando...`;
    }

    try {
        const fileInput = document.getElementById('capaInput');
        let capaURL = "";

        if (fileInput && fileInput.files && fileInput.files[0]) {
            capaURL = await imageToBase64(fileInput.files[0]);
        }

        if (!database[currentSheet]) {
            database[currentSheet] = [];
        }

        database[currentSheet].push({
            id: '_' + Math.random().toString(36).substr(2, 9), 
            capa: capaURL,
            editora: document.getElementById('editora').value.trim(),
            categoria: document.getElementById('categoria').value.trim(),
            serie: document.getElementById('serie').value.trim(),
            numero: parseInt(document.getElementById('numero').value) || 0,
            data: document.getElementById('data').value.trim(),
            estado: document.getElementById('estado').value.trim()
        });

        await saveData(currentSheet);
        updateCategoryFilterOptions();
        renderTable(); 
        document.getElementById('addGibiForm').reset();
    } catch (err) {
        console.error("Erro ao adicionar gibi:", err);
        alert("Erro ao adicionar o gibi. Verifique o console.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = submitBtn.dataset.originalHtml || 'Adicionar';
        }
    }
};

window.deleteGibi = async function(index) {
    if (confirm("Remover este gibi?")) { 
        database[currentSheet].splice(index, 1); 
        editingId = null;
        await saveData(currentSheet); 
        updateCategoryFilterOptions();
        renderTable(); 
    }
};

window.cancelEdit = function() { 
    editingId = null; 
    renderTable(); 
};

window.saveEdit = async function(sheetName, gibiId) {
    const targetSheet = sheetName || currentSheet;
    
    // Busca EXATA pelo ID do gibi, evitando qualquer problema de índice cruzado
    const itemIndex = database[targetSheet].findIndex(item => item.id === gibiId);

    if (itemIndex === -1) {
        alert("Erro: Gibi não encontrado para edição.");
        return;
    }

    const fileInput = document.getElementById(`editCapa_${gibiId}`);
    let capaURL = database[targetSheet][itemIndex].capa || "";

    if (fileInput && fileInput.files && fileInput.files[0]) {
        try {
            capaURL = await imageToBase64(fileInput.files[0]);
        } catch (err) {
            console.error("Erro ao converter nova capa na edição:", err);
        }
    }

    database[targetSheet][itemIndex] = {
        id: gibiId, 
        capa: capaURL,
        numero: parseInt(document.getElementById(`editNumero_${gibiId}`).value) || 0,
        editora: document.getElementById(`editEditora_${gibiId}`).value.trim(),
        categoria: document.getElementById(`editCategoria_${gibiId}`).value.trim(),
        serie: document.getElementById(`editSerie_${gibiId}`).value.trim(),
        data: document.getElementById(`editData_${gibiId}`).value.trim(),
        estado: document.getElementById(`editEstado_${gibiId}`).value.trim()
    };

    editingId = null;
    await saveData(targetSheet);
    updateCategoryFilterOptions();
    renderTable();
};

// 8. Modal de Imagem
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

// ==========================================================================
// 9. RENDERIZAÇÃO DA TABELA (Com Busca Global e Palavras Compostas)
// ==========================================================================

window.startEditInSheet = function(sheetName, gibiId) {
    currentSheet = sheetName;
    const select = document.getElementById('sheetSelect');
    if (select) select.value = sheetName;
    editingId = gibiId;
    renderTable();
};

window.deleteGibiInSheet = async function(sheetName, index) {
    if (confirm(`Remover este gibi da coleção "${sheetName}"?`)) { 
        database[sheetName].splice(index, 1); 
        editingId = null;
        await saveData(sheetName); 
        updateCategoryFilterOptions();
        renderTable(); 
    }
};

function updateCounters(renderedCount = 0, isGlobal = false) {
    const totalCurrentSheet = database[currentSheet] ? database[currentSheet].length : 0;
    const totalAllSheets = Object.values(database).reduce((acc, sheet) => acc + (Array.isArray(sheet) ? sheet.length : 0), 0);

    const listCounterEl = document.getElementById('listCounter') || document.getElementById('counterCurrentSheet');
    if (listCounterEl) {
        if (isGlobal) {
            listCounterEl.innerText = `${renderedCount} encontrado(s)`;
        } else {
            // Mantém a fraseologia correta unindo o texto descritivo ao valor calculado
            listCounterEl.innerText = `Gibis nesta coleção: ${renderedCount} (de ${totalCurrentSheet})`;
        }
    }

    const totalCounterEl = document.getElementById('totalCounter') || document.getElementById('counterTotal');
    if (totalCounterEl) {
        // Mantém a fraseologia correta para o total geral
        totalCounterEl.innerText = `Total Geral de Gibis: ${totalAllSheets}`;
    }
}

window.renderTable = function() {
    const tbody = document.getElementById('tableBody'); 
    if (!tbody) return;

    const selectedFilter = document.getElementById('categoryFilter') ? document.getElementById('categoryFilter').value : "TODAS";
    const searchInput = document.getElementById('searchInput');
    const rawSearch = searchInput ? searchInput.value.trim() : "";

    tbody.innerHTML = '';

    let itemsToRender = [];
    const isGlobalSearch = rawSearch !== "";

    // Função auxiliar para remover acentos e converter para minúsculas
    const normalizeStr = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    if (isGlobalSearch) {
        const terms = rawSearch.split(/\s+/).filter(Boolean).map(normalizeStr);

        Object.keys(database).forEach(sheetName => {
            const sheetItems = database[sheetName];
            if (Array.isArray(sheetItems)) {
                sheetItems.forEach(item => {
                    const rawContent = [
                        sheetName,
                        item.numero !== undefined && item.numero !== null ? item.numero.toString() : "",
                        item.editora || "",
                        item.categoria || "",
                        item.serie || "",
                        item.data || "",
                        item.estado || ""
                    ].join(" ");

                    const itemContent = normalizeStr(rawContent);

                    // .every garante que todos os termos digitados precisem estar presentes (ex: "monica 56")
                    const matchesSearch = terms.every(term => itemContent.includes(term));
                    const matchesCategory = selectedFilter === "TODAS" || (item.categoria && item.categoria.trim() === selectedFilter);

                    if (matchesSearch && matchesCategory) {
                        itemsToRender.push({ ...item, _originSheet: sheetName });
                    }
                });
            }
        });
    } else {
        if (!database[currentSheet]) {
            updateCounters(0, false);
            return;
        }

        let currentItems = [...database[currentSheet]];

        if (selectedFilter !== "TODAS") {
            currentItems = currentItems.filter(item => item.categoria && item.categoria.trim() === selectedFilter);
        }

        currentItems.sort((a, b) => a.numero - b.numero);

        itemsToRender = currentItems.map(item => ({ ...item, _originSheet: currentSheet }));
    }

    itemsToRender.forEach((item) => {
        const originSheet = item._originSheet;
        const indexNoBanco = database[originSheet].findIndex(dbItem => dbItem.id === item.id);
        const tr = document.createElement('tr');

        if (!item.id) {
            item.id = '_' + Math.random().toString(36).substr(2, 9);
        }

        if (editingId === item.id && currentSheet === originSheet) {
            tr.innerHTML = `
                <td class="capa-cell"><input type="file" id="editCapa_${item.id}" accept="image/*" style="font-size:10px; width:70px;"></td>
                <td><strong>${originSheet}</strong></td>
                <td><input type="number" id="editNumero_${item.id}"></td>
                <td><input type="text" id="editEditora_${item.id}"></td>
                <td><input type="text" id="editCategoria_${item.id}"></td>
                <td><input type="text" id="editSerie_${item.id}"></td>
                <td><input type="text" id="editData_${item.id}"></td>
                <td><input type="text" id="editEstado_${item.id}"></td>
                <td class="actions-cell no-pdf">
                    <button class="btn-save" onclick="saveEdit('${originSheet}', '${item.id}')">Salvar</button>
                    <button class="btn-cancel" onclick="cancelEdit()">X</button>
                </td>
            `;

            setTimeout(() => {
                const elNum = tr.querySelector(`#editNumero_${item.id}`);
                const elEd = tr.querySelector(`#editEditora_${item.id}`);
                const elCat = tr.querySelector(`#editCategoria_${item.id}`);
                const elSer = tr.querySelector(`#editSerie_${item.id}`);
                const elData = tr.querySelector(`#editData_${item.id}`);
                const elEst = tr.querySelector(`#editEstado_${item.id}`);

                if (elNum) elNum.value = item.numero;
                if (elEd) elEd.value = item.editora || '';
                if (elCat) elCat.value = item.categoria || '';
                if (elSer) elSer.value = item.serie || '';
                if (elData) elData.value = item.data || '';
                if (elEst) elEst.value = item.estado || '';
            }, 0);

        } else {
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
                <button class="btn-edit" onclick="startEditInSheet('${originSheet}', '${item.id}')">Editar</button>
                <button class="btn-delete" onclick="deleteGibiInSheet('${originSheet}', ${indexNoBanco})">Excluir</button>
            `;

            tr.appendChild(tdCapa);
            tr.appendChild(tdPersonagem);
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

    updateCounters(itemsToRender.length, isGlobalSearch);
};

// 10. Funções do Backup JSON
window.exportarBackup = function() {
    if (!database || Object.keys(database).length === 0) {
        alert("Não há dados para exportar.");
        return;
    }

    const backupData = JSON.stringify({ database, fundosPersonagens }, null, 2);
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
                if (data.fundosPersonagens) {
                    fundosPersonagens = data.fundosPersonagens;
                }
                
                for (const sheetName of Object.keys(database)) {
                    await saveData(sheetName);
                }
                await saveUserMeta();

                const sheets = Object.keys(database);
                currentSheet = sheets.length > 0 ? sheets[0] : "";

                init();
                alert("Backup de TODAS as listas foi restaurado com sucesso!");
            } else {
                alert("Arquivo de backup inválido. A chave 'database' não foi encontrada.");
            }
        } catch (err) {
            console.error(err);
            alert("Erro ao ler o arquivo de backup. Verifique se é um arquivo JSON válido.");
        }
    };
    reader.readAsText(file);
};

// 11. Exportação para PDF
window.exportToPDF = function() {
    const element = document.getElementById('pdfContent');
    const actionCols = document.querySelectorAll('.no-pdf');
    
    actionCols.forEach(el => el.style.display = 'none');

    const opt = { 
        margin: 8, 
        filename: `Colecao_${currentSheet}.pdf`, 
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

// Função única para alternar o tema (cicla entre: Automático -> Escuro -> Claro -> Automático)
window.toggleDarkMode = function() {
    const root = document.documentElement;
    
    // Alterna diretamente entre 'dark-mode' e 'light-mode'
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

// Executa ao carregar a página para manter a preferência salva
window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.classList.add(savedTheme + '-mode');
    }
});