// content.js
let translations = {};
let highlightEnabled = true;
let highlightedElements = new Set();
let lastSelectedText = ''; // 儲存最後選取的文字

// 監聽文字選取事件
document.addEventListener('selectionchange', function() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (selectedText && selectedText.length > 0) {
        lastSelectedText = selectedText;
        console.log('文字已選取:', selectedText);
    }
});

// 監聽來自 popup 的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log('Content script 收到消息:', request);
    switch(request.action) {
        case 'getSelectedText':
            // 首先嘗試獲取當前選取的文字，如果沒有則使用最後選取的文字
            const currentSelectedText = getSelectedText();
            const textToSend = currentSelectedText || lastSelectedText;
            console.log('傳送選取的文字:', textToSend);
            sendResponse({text: textToSend});
            break;
        case 'updateTranslations':
            translations = request.translations;
            highlightTranslations();
            break;
        case 'toggleHighlight':
            highlightEnabled = request.enabled;
            if (highlightEnabled) {
                highlightTranslations();
            } else {
                removeHighlights();
            }
            break;
        case 'showTranslatePrompt':
            showTranslatePrompt(request.text);
            break;
    }
    return true; // 保持消息通道開啟
});

// 初始化
init();

function init() {
    console.log('Content script 初始化中...');
    loadTranslations();
    loadSettings();

    // 添加網站識別
    document.body.setAttribute('data-domain', window.location.hostname);

    // 檢查是否為 Google 搜尋頁面
    const isGoogleSearch = window.location.hostname.includes('google') && 
                          (window.location.pathname.includes('/search') || 
                           window.location.search.includes('?q=') || 
                           window.location.search.includes('&q='));
    
    if (isGoogleSearch) {
        document.body.setAttribute('data-site', 'google-search');
        highlightEnabled = false;
    }
    
    // 監聽頁面變化
    const observer = new MutationObserver(function(mutations) {
        if (highlightEnabled) {
            highlightTranslations();
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 載入翻譯資料
function loadTranslations() {
    chrome.storage.local.get(['translations'], function(result) {
        translations = result.translations || {};
        console.log('載入的翻譯:', translations); // 添加此行來除錯
        if (highlightEnabled) {
            highlightTranslations();
        }
    });
}

// 載入設定
function loadSettings() {
    chrome.storage.sync.get(['highlightEnabled'], function(result) {
        highlightEnabled = result.highlightEnabled !== false;
        console.log('Highlight 狀態:', highlightEnabled); // 添加此行來除錯
        if (highlightEnabled) {
            highlightTranslations();
        }
    });
}

// 獲取選取的文字
// 獲取選取的文字
function getSelectedText() {
    try {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        console.log('獲取選取文字:', selectedText);
        return selectedText;
    } catch (error) {
        console.error('獲取選取文字時發生錯誤:', error);
        return '';
    }
}

// 標記翻譯
function highlightTranslations() {
    // 如果是 Google 搜尋頁面，直接返回
    if (document.body.getAttribute('data-site') === 'google-search') {
        return;
    }
    
    console.log('開始標記翻譯'); // 添加此行來除錯
    if (!highlightEnabled || Object.keys(translations).length === 0) {
        console.log('未啟用標記或無翻譯資料'); // 添加此行來除錯
        return;
    }
    
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // 跳過已標記的元素
                if (node.parentElement && node.parentElement.classList.contains('translation-highlight')) {
                    return NodeFilter.FILTER_REJECT;
                }
                // 跳過 script 和 style 標籤
                const tagName = node.parentElement.tagName.toLowerCase();
                if (tagName === 'script' || tagName === 'style') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    const textNodes = [];
    let node;
    
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    
    textNodes.forEach(textNode => {
        highlightTextNode(textNode);
    });
}

// 標記文字節點
function highlightTextNode(textNode) {
    let text = textNode.textContent;
    let hasMatch = false;
    
    // 創建匹配模式
    const words = Object.keys(translations);
    if (words.length === 0) return;
    
    // 按長度排序，優先匹配較長的詞彙
    words.sort((a, b) => b.length - a.length);
    
    for (const word of words) {
        const regex = new RegExp(escapeRegExp(word), 'gi');
        if (regex.test(text)) {
            hasMatch = true;
            break;
        }
    }
    
    if (!hasMatch) return;
    
    // 創建替換的 HTML
    let newHTML = text;
    
    for (const word of words) {
        const regex = new RegExp(escapeRegExp(word), 'gi');
        newHTML = newHTML.replace(regex, function(match) {
            const translation = translations[word.toLowerCase()];
            return `<span class="translation-highlight" data-original="${match}" data-translation="${translation.translation}" title="${match} → ${translation.translation}">${match}</span>`;
        });
    }
    
    if (newHTML !== text) {
        const wrapper = document.createElement('span');
        wrapper.innerHTML = newHTML.trim(); // 修剪前後空白

        // 優化空白節點處理
        const fragment = document.createDocumentFragment();
        Array.from(wrapper.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                const trimmed = node.textContent;
                if (trimmed) {
                    fragment.appendChild(document.createTextNode(trimmed));
                }
            } else {
                fragment.appendChild(node);
            }
        });
        
        // 替換原始節點
        const parent = textNode.parentNode;
        parent.replaceChild(fragment, textNode);
        parent.normalize();
    }
}

// 移除所有標記
function removeHighlights() {
    const highlights = document.querySelectorAll('.translation-highlight');
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize();
    });
}

// 轉義正規表達式特殊字符
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 添加工具提示功能
document.body.addEventListener('mouseover', function(e) {
    const highlightEl = e.target.closest('.translation-highlight');
    if (highlightEl) {
        showTooltip(highlightEl, e);
    }
});

document.body.addEventListener('mouseout', function(e) {
    const highlightEl = e.target.closest('.translation-highlight');
    const tooltipEl = e.target.closest('.translation-tooltip');
    
    if (highlightEl && !tooltipEl) {
        hideTooltip();
    }
});

let tooltip = null;
let currentTooltipElement = null;
let scrollListener = null;

function showTooltip(element, event) {
    const original = element.getAttribute('data-original');
    const translation = element.getAttribute('data-translation');
    
    if (tooltip) {
        hideTooltip();
    }
    
    currentTooltipElement = element;
    
    tooltip = document.createElement('div');
    tooltip.className = 'translation-tooltip';
    tooltip.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        max-width: 250px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
    `;
    
    tooltip.innerHTML = `
        <div style="font-weight: 500; margin-bottom: 2px;">${original}</div>
        <div style="font-size: 12px; opacity: 0.8;">${translation}</div>
    `;
    
    document.body.appendChild(tooltip);
    
    // 初始定位
    updateTooltipPosition();
    
    // 顯示動畫
    requestAnimationFrame(() => {
        tooltip.style.opacity = '1';
    });
    
    // 添加滾動監聽器
    scrollListener = function() {
        if (tooltip && currentTooltipElement) {
            updateTooltipPosition();
        }
    };
    
    window.addEventListener('scroll', scrollListener, { passive: true });
    document.addEventListener('scroll', scrollListener, { passive: true });
}

function updateTooltipPosition() {
    if (!tooltip || !currentTooltipElement) return;
    
    const rect = currentTooltipElement.getBoundingClientRect();
    
    // 檢查元素是否還在視窗內
    if (rect.bottom < 0 || rect.top > window.innerHeight || 
        rect.right < 0 || rect.left > window.innerWidth) {
        hideTooltip();
        return;
    }
    
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 8;
    
    // 計算最佳位置
    let top = rect.bottom + margin;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    
    // 檢查是否會超出視窗底部
    if (top + tooltipRect.height > window.innerHeight - margin) {
        top = rect.top - tooltipRect.height - margin;
    }
    
    // 檢查是否會超出視窗左側
    if (left < margin) {
        left = margin;
    }
    
    // 檢查是否會超出視窗右側
    if (left + tooltipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tooltipRect.width - margin;
    }
    
    // 檢查是否會超出視窗頂部
    if (top < margin) {
        top = rect.bottom + margin;
    }
    
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function hideTooltip() {
    if (tooltip) {
        tooltip.style.opacity = '0';
        setTimeout(() => {
            if (tooltip) {
                tooltip.remove();
                tooltip = null;
            }
        }, 200);
    }
    
    currentTooltipElement = null;
    
    // 移除滾動監聽器
    if (scrollListener) {
        window.removeEventListener('scroll', scrollListener);
        document.removeEventListener('scroll', scrollListener);
        scrollListener = null;
    }
}

// 顯示翻譯提示
function showTranslatePrompt(text) {
    // 創建提示元素
    const prompt = document.createElement('div');
    prompt.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 300px;
        cursor: pointer;
        transition: all 0.3s ease;
    `;
    
    prompt.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px;">已選取文字準備翻譯</div>
        <div style="font-size: 12px; opacity: 0.9;">"${text.length > 30 ? text.substring(0, 30) + '...' : text}"</div>
        <div style="font-size: 11px; margin-top: 4px; opacity: 0.8;">點擊擴充功能圖示開始翻譯</div>
    `;
    
    // 添加懸停效果
    prompt.addEventListener('mouseenter', function() {
        prompt.style.transform = 'scale(1.02)';
    });
    
    prompt.addEventListener('mouseleave', function() {
        prompt.style.transform = 'scale(1)';
    });
    
    // 點擊提示框時嘗試開啟擴充功能
    prompt.addEventListener('click', function() {
        // 移除提示框
        prompt.remove();
        // 這裡無法直接開啟 popup，只能提示用戶
        console.log('用戶點擊了翻譯提示');
    });
    
    // 添加到頁面
    document.body.appendChild(prompt);
    
    // 3秒後自動移除
    setTimeout(function() {
        if (prompt.parentNode) {
            prompt.style.opacity = '0';
            setTimeout(() => {
                if (prompt.parentNode) {
                    prompt.remove();
                }
            }, 300);
        }
    }, 3000);
}