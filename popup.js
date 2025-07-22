// popup.js
document.addEventListener('DOMContentLoaded', function() {
    const sourceText = document.getElementById('sourceText');
    const translation = document.getElementById('translation');
    const saveButton = document.getElementById('saveTranslation');
    const openManagerButton = document.getElementById('openManager');
    const highlightToggle = document.getElementById('highlightToggle');
    const wordCountEl = document.getElementById('wordCount');
    const todayCountEl = document.getElementById('todayCount');
    const targetLanguage = document.getElementById('targetLanguage');
    const resultEl = document.getElementById('result');
    const resultText = document.getElementById('resultText');
    
    let translateTimeout = null;

    // 載入上次選擇的語言
    chrome.storage.sync.get(['targetLanguage'], function(result) {
        if (result.targetLanguage) {
            targetLanguage.value = result.targetLanguage;
        }
    });

    // 監聽語言選擇變更
    targetLanguage.addEventListener('change', function() {
        chrome.storage.sync.set({ targetLanguage: targetLanguage.value });
        const text = sourceText.value.trim();
        if (text) {
            translateAndUpdate(text);
        }
    });
    
    // 載入統計資訊
    loadStats();
    
    // 載入設定
    loadSettings();
    
    // 檢查是否有待翻譯的文字（來自右鍵選單）
    chrome.storage.local.get(['pendingTranslation'], function(result) {
        if (result.pendingTranslation) {
            const pending = result.pendingTranslation;
            // 檢查是否是最近的請求（避免舊的請求）
            if (Date.now() - pending.timestamp < 5000) { // 5秒內的請求才有效
                console.log('發現待翻譯文字:', pending.text);
                sourceText.value = pending.text;
                translateAndUpdate(pending.text);
                checkExistingTranslation(pending.text);
            }
            // 清除待翻譯的文字
            chrome.storage.local.remove(['pendingTranslation']);
        }
    });
    
    // 檢查是否有選取的文字
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || !tabs[0] || !tabs[0].id) {
            console.log('未找到活動分頁');
            return;
        }

        console.log('嘗試取得選取文字...');
        // 檢查是否在允許的頁面上
        const url = tabs[0].url;
        if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
            console.log('在特殊頁面上無法使用選取文字功能');
            return;
        }

        // 先嘗試注入 content script（以防它未載入）
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
                // 確保 getSelectedText 函數存在
                if (typeof getSelectedText === 'undefined') {
                    window.getSelectedText = function() {
                        const selection = window.getSelection();
                        return selection.toString().trim();
                    };
                }
            }
        }).then(() => {
            // 然後發送消息獲取選取的文字
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'getSelectedText'
            }, function(response) {
                if (chrome.runtime.lastError) {
                    console.log('嘗試直接獲取選取文字...');
                    // 如果消息發送失敗，直接執行腳本獲取選取文字
                    chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        func: () => {
                            const selection = window.getSelection();
                            return selection.toString().trim();
                        }
                    }).then((results) => {
                        if (results && results[0] && results[0].result) {
                            const selectedText = results[0].result;
                            console.log('直接獲取的選取文字:', selectedText);
                            if (selectedText) {
                                sourceText.value = selectedText;
                                translateAndUpdate(selectedText);
                                checkExistingTranslation(selectedText);
                            }
                        }
                    }).catch(error => {
                        console.log('無法獲取選取文字:', error);
                    });
                    return;
                }
                
                console.log('收到選取文字回應:', response);
                if (response && response.text) {
                    sourceText.value = response.text;
                    translateAndUpdate(response.text);
                    checkExistingTranslation(response.text);
                }
            });
        }).catch(error => {
            console.log('注入腳本失敗:', error);
        });
    });

    // 自動翻譯功能
    async function translateAndUpdate(text) {
        if (!text.trim()) return;
        
        // 顯示翻譯中狀態
        translation.value = '翻譯中...';
        translation.style.color = '#666';
        saveButton.disabled = true;
        
        try {
            chrome.runtime.sendMessage({
                action: 'translate',
                text: text,
                targetLang: targetLanguage.value || 'zh-TW'
            }, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('翻譯請求失敗:', chrome.runtime.lastError);
                    translation.value = '翻譯失敗: ' + chrome.runtime.lastError.message;
                    translation.style.color = '#e74c3c';
                    showResult('翻譯請求失敗', 'error');
                    return;
                }
                
                if (response && response.translation) {
                    translation.value = response.translation;
                    translation.style.color = '#333';
                    saveButton.disabled = false; // 啟用儲存按鈕
                    showResult('翻譯完成', 'success');
                } else {
                    const errorMsg = response ? response.error : '未知錯誤';
                    translation.value = '翻譯失敗: ' + errorMsg;
                    translation.style.color = '#e74c3c';
                    showResult('翻譯失敗: ' + errorMsg, 'error');
                    console.error('翻譯錯誤:', errorMsg);
                }
            });
        } catch (error) {
            console.error('翻譯錯誤:', error);
            translation.value = '翻譯失敗: ' + error.message;
            translation.style.color = '#e74c3c';
            showResult('翻譯失敗: ' + error.message, 'error');
        }
    }

    // 防抖動函數
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 即時翻譯 - 當使用者輸入時自動翻譯
    sourceText.addEventListener('input', debounce(function() {
        const text = sourceText.value.trim();
        if (text) {
            translateAndUpdate(text);
        } else {
            translation.value = '';
            saveButton.disabled = true;
        }
    }, 800)); // 等待800ms後才翻譯，避免過於頻繁
    
    // 監聽翻譯結果變化，更新儲存按鈕狀態
    translation.addEventListener('input', function() {
        const hasText = sourceText.value.trim().length > 0;
        const hasTranslation = translation.value.trim().length > 0;
        saveButton.disabled = !(hasText && hasTranslation);
    });
    
    // 儲存翻譯
    saveButton.addEventListener('click', function() {
        const source = sourceText.value.trim();
        const trans = translation.value.trim();
        
        if (!source || !trans) {
            showResult('請輸入原文和翻譯', 'error');
            return;
        }
        
        saveTranslation(source, trans);
    });
    
    // 開啟管理頁面
    openManagerButton.addEventListener('click', function() {
        chrome.tabs.create({
            url: chrome.runtime.getURL('manager.html')
        });
    });
    
    // 標記功能開關
    highlightToggle.addEventListener('change', function() {
        const enabled = highlightToggle.checked;
        chrome.storage.sync.set({highlightEnabled: enabled}, function() {
            // 通知所有標籤頁更新標記狀態
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'toggleHighlight',
                        enabled: enabled
                    });
                });
            });
        });
    });
    

    
    // 載入統計資訊
    function loadStats() {
        chrome.storage.local.get(['translations', 'todayTranslations'], function(result) {
            const translations = result.translations || {};
            const todayTranslations = result.todayTranslations || {};
            const today = new Date().toDateString();
            
            console.log('Popup 載入的翻譯資料:', translations);
            console.log('Popup 翻譯項目數量:', Object.keys(translations).length);
            console.log('今日翻譯資料:', todayTranslations);
            
            wordCountEl.textContent = Object.keys(translations).length;
            todayCountEl.textContent = todayTranslations[today] || 0;
        });
    }
    
    // 載入設定
    function loadSettings() {
        chrome.storage.sync.get(['highlightEnabled'], function(result) {
            highlightToggle.checked = result.highlightEnabled !== false;
        });
    }
    
    // 檢查現有翻譯
    function checkExistingTranslation(text) {
        chrome.storage.local.get(['translations'], function(result) {
            const translations = result.translations || {};
            const normalizedText = text.toLowerCase().trim();
            
            for (const [key, value] of Object.entries(translations)) {
                if (key.toLowerCase() === normalizedText) {
                    translation.value = value.translation;
                    showResult('找到現有翻譯', 'info');
                    break;
                }
            }
        });
    }
    
    // 儲存翻譯
    function saveTranslation(source, trans) {        
        const translationData = {
            translation: trans,
            timestamp: Date.now(),
            count: 1
        };
        
        chrome.storage.local.get(['translations', 'todayTranslations'], function(result) {
            const translations = result.translations || {};
            const todayTranslations = result.todayTranslations || {};
            const today = new Date().toDateString();
            const normalizedSource = source.toLowerCase().trim();
            
            // 如果已存在，增加計數
            if (translations[normalizedSource]) {
                translations[normalizedSource].count++;
                translations[normalizedSource].timestamp = Date.now();
            } else {
                translations[normalizedSource] = translationData;
                // 更新今日翻譯計數
                todayTranslations[today] = (todayTranslations[today] || 0) + 1;
            }
            
            // 儲存到本地存儲
            chrome.storage.local.set({
                translations: translations,
                todayTranslations: todayTranslations
            }, function() {
                showResult('翻譯已儲存！', 'success');
                loadStats();
                
                // 通知所有標籤頁更新標記
                chrome.tabs.query({}, function(tabs) {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'updateTranslations',
                            translations: translations
                        });
                    });
                });
            });
        });
    }
    
    // 顯示結果訊息
    function showResult(message, type) {
        resultText.textContent = message;
        resultEl.className = `result ${type}`;
        resultEl.style.display = 'block';
        
        // 3秒後隱藏
        setTimeout(() => {
            resultEl.style.display = 'none';
        }, 3000);
    }
});