// manager.js
let translations = {};
let filteredTranslations = {};
let currentPage = 1;
const itemsPerPage = 20;
let editingKey = null;

// DOM 元素
const searchInput = document.getElementById('searchInput');
const translationsList = document.getElementById('translationsList');
const pagination = document.getElementById('pagination');
const editModal = document.getElementById('editModal');
const editForm = document.getElementById('editForm');
const editOriginal = document.getElementById('editOriginal');
const editTranslationInput = document.getElementById('editTranslation');
const clearAllBtn = document.getElementById('clearAllBtn');
const refreshBtn = document.getElementById('refreshBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    loadTranslations();
    setupEventListeners();
    setupStorageListener();
});

// 設定 Storage 變化監聽器
function setupStorageListener() {
    // 監聽 storage 變化
    chrome.storage.onChanged.addListener(function(changes, namespace) {
        if (namespace === 'local' && changes.translations) {
            console.log('檢測到翻譯資料變化，重新載入...');
            loadTranslations();
        }
    });
}

// 載入翻譯資料
function loadTranslations() {
    chrome.storage.local.get(['translations', 'todayTranslations'], function(result) {
        translations = result.translations || {};
        filteredTranslations = {...translations};
        
        console.log('Manager 載入的翻譯資料:', translations);
        console.log('翻譯項目數量:', Object.keys(translations).length);
        
        updateStats();
        renderTranslations();
    });
}

// 設定事件監聽器
function setupEventListeners() {
    // 搜尋功能
    searchInput.addEventListener('input', function() {
        const query = this.value.toLowerCase();
        filteredTranslations = {};
        
        for (const [key, value] of Object.entries(translations)) {
            if (key.includes(query) || value.translation.toLowerCase().includes(query)) {
                filteredTranslations[key] = value;
            }
        }
        
        currentPage = 1;
        renderTranslations();
    });
    
    // 重新載入按鈕
    refreshBtn.addEventListener('click', function() {
        console.log('手動重新載入翻譯資料...');
        refreshBtn.textContent = '🔄 載入中...';
        refreshBtn.disabled = true;
        
        loadTranslations();
        
        setTimeout(() => {
            refreshBtn.textContent = '🔄 重新載入';
            refreshBtn.disabled = false;
        }, 500);
    });
    
    // 清除全部
    clearAllBtn.addEventListener('click', function() {
        if (confirm('確定要清除所有翻譯資料嗎？此操作無法復原！')) {
            chrome.storage.local.set({
                translations: {},
                todayTranslations: {}
            }, function() {
                translations = {};
                filteredTranslations = {};
                updateStats();
                renderTranslations();
                
                // 通知所有標籤頁更新
                chrome.tabs.query({}, function(tabs) {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'updateTranslations',
                            translations: {}
                        });
                    });
                });
            });
        }
    });
    
    // 匯出功能
    exportJsonBtn.addEventListener('click', () => exportData('json'));
    exportCsvBtn.addEventListener('click', () => exportData('csv'));
    
    // 匯入功能
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importData);
    
    // 編輯模態框
    document.querySelector('.close').addEventListener('click', closeEditModal);
    document.getElementById('cancelEdit').addEventListener('click', closeEditModal);
    editForm.addEventListener('submit', saveEdit);
    
    // 點擊模態框外部關閉
    window.addEventListener('click', function(event) {
        if (event.target === editModal) {
            closeEditModal();
        }
    });
}

// 更新統計資訊
function updateStats() {
    const totalWords = Object.keys(translations).length;
    const today = new Date().toDateString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).getTime();
    
    let todayWords = 0;
    let weekWords = 0;
    let frequentWords = 0;
    
    chrome.storage.local.get(['todayTranslations'], function(result) {
        const todayTranslations = result.todayTranslations || {};
        todayWords = todayTranslations[today] || 0;
        
        for (const [key, value] of Object.entries(translations)) {
            if (value.timestamp >= weekAgo) {
                weekWords++;
            }
            if (value.count >= 3) {
                frequentWords++;
            }
        }
        
        document.getElementById('totalWords').textContent = totalWords;
        document.getElementById('todayWords').textContent = todayWords;
        document.getElementById('weekWords').textContent = weekWords;
        document.getElementById('frequentWords').textContent = frequentWords;
    });
}

// 渲染翻譯列表
function renderTranslations() {
    const keys = Object.keys(filteredTranslations);
    const totalItems = keys.length;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const pageItems = keys.slice(startIndex, endIndex);
    
    if (totalItems === 0) {
        translationsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📚</div>
                <div class="empty-message">沒有找到翻譯資料</div>
                <div class="empty-submessage">開始翻譯一些詞彙吧！</div>
            </div>
        `;
        pagination.innerHTML = '';
        return;
    }
    
    // 按時間排序
    pageItems.sort((a, b) => filteredTranslations[b].timestamp - filteredTranslations[a].timestamp);
    
    const html = pageItems.map(key => {
        const item = filteredTranslations[key];
        const date = new Date(item.timestamp).toLocaleDateString('zh-TW');
        
        return `
            <div class="translation-item" data-key="${key}">
                <div class="original-text">${key}</div>
                <div class="translated-text">${item.translation}</div>
                <div class="translation-count">${item.count}次</div>
                <div class="translation-date">${date}</div>
                <div class="item-actions">
                    <button class="action-btn edit-btn" onclick="editTranslation('${key}')">編輯</button>
                    <button class="action-btn delete-btn" onclick="deleteTranslation('${key}')">刪除</button>
                </div>
            </div>
        `;
    }).join('');
    
    translationsList.innerHTML = html;
    renderPagination(totalItems);
}

// 渲染分頁
function renderPagination(totalItems) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // 上一頁
    html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">上一頁</button>`;
    
    // 頁碼
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage) {
            html += `<button class="active">${i}</button>`;
        } else if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
            html += `<button onclick="changePage(${i})">${i}</button>`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += '<span>...</span>';
        }
    }
    
    // 下一頁
    html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">下一頁</button>`;
    
    pagination.innerHTML = html;
}

// 變更頁面
function changePage(page) {
    currentPage = page;
    renderTranslations();
}

// 編輯翻譯
function editTranslation(key) {
    editingKey = key;
    const item = translations[key];
    
    editOriginal.value = key;
    document.getElementById('editTranslation').value = item.translation;
    
    editModal.style.display = 'block';
}

// 儲存編輯
function saveEdit(e) {
    e.preventDefault();
    
    const newOriginal = editOriginal.value.trim().toLowerCase();
    const newTranslation = document.getElementById('editTranslation').value.trim();
    
    if (!newOriginal || !newTranslation) {
        alert('請填寫完整資訊');
        return;
    }
    
    // 如果原文改變了，需要刪除舊的並新增新的
    if (newOriginal !== editingKey) {
        delete translations[editingKey];
    }
    
    translations[newOriginal] = {
        translation: newTranslation,
        timestamp: Date.now(),
        count: translations[editingKey]?.count || 1
    };
    
    // 儲存到 Chrome storage
    chrome.storage.local.set({translations: translations}, function() {
        filteredTranslations = {...translations};
        renderTranslations();
        updateStats();
        closeEditModal();
        
        // 通知所有標籤頁更新
        chrome.tabs.query({}, function(tabs) {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'updateTranslations',
                    translations: translations
                });
            });
        });
    });
}

// 關閉編輯模態框
function closeEditModal() {
    editModal.style.display = 'none';
    editingKey = null;
    editForm.reset();
}

// 刪除翻譯
function deleteTranslation(key) {
    if (confirm(`確定要刪除「${key}」的翻譯嗎？`)) {
        delete translations[key];
        delete filteredTranslations[key];
        
        chrome.storage.local.set({translations: translations}, function() {
            renderTranslations();
            updateStats();
            
            // 通知所有標籤頁更新
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'updateTranslations',
                        translations: translations
                    });
                });
            });
        });
    }
}

// 匯出資料
function exportData(format) {
    const data = Object.entries(translations).map(([key, value]) => ({
        original: key,
        translation: value.translation,
        count: value.count,
        timestamp: new Date(value.timestamp).toISOString()
    }));
    
    let content, filename, mimeType;
    
    if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        filename = `translations_${new Date().toISOString().split('T')[0]}.json`;
        mimeType = 'application/json';
    } else if (format === 'csv') {
        const headers = ['原文', '翻譯', '使用次數', '時間'];
        const csvContent = [
            headers.join(','),
            ...data.map(item => [
                `"${item.original}"`,
                `"${item.translation}"`,
                item.count,
                `"${item.timestamp}"`
            ].join(','))
        ].join('\n');
        
        content = csvContent;
        filename = `translations_${new Date().toISOString().split('T')[0]}.csv`;
        mimeType = 'text/csv';
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// 匯入資料
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            let importedData;
            
            if (file.name.endsWith('.json')) {
                importedData = JSON.parse(e.target.result);
            } else if (file.name.endsWith('.csv')) {
                const lines = e.target.result.split('\n');
                const headers = lines[0].split(',');
                importedData = lines.slice(1).map(line => {
                    const values = line.split(',');
                    return {
                        original: values[0]?.replace(/"/g, ''),
                        translation: values[1]?.replace(/"/g, ''),
                        count: parseInt(values[2]) || 1,
                        timestamp: new Date(values[3]?.replace(/"/g, '')).getTime()
                    };
                }).filter(item => item.original && item.translation);
            }
            
            if (importedData && importedData.length > 0) {
                const newTranslations = {};
                
                importedData.forEach(item => {
                    newTranslations[item.original.toLowerCase()] = {
                        translation: item.translation,
                        count: item.count || 1,
                        timestamp: item.timestamp || Date.now()
                    };
                });
                
                // 合併現有資料
                const mergedTranslations = {...translations, ...newTranslations};
                
                chrome.storage.local.set({translations: mergedTranslations}, function() {
                    translations = mergedTranslations;
                    filteredTranslations = {...translations};
                    renderTranslations();
                    updateStats();
                    
                    alert(`成功匯入 ${importedData.length} 個翻譯`);
                    
                    // 通知所有標籤頁更新
                    chrome.tabs.query({}, function(tabs) {
                        tabs.forEach(tab => {
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'updateTranslations',
                                translations: translations
                            });
                        });
                    });
                });
            }
        } catch (error) {
            alert('匯入失敗：檔案格式不正確');
        }
    };
    
    reader.readAsText(file);
    event.target.value = '';
}