/**
 * -----------------------------------------------------------------------------------
 * textareaやインプットに置ける自動補完機能
 * -----------------------------------------------------------------------------------
 */



/**
 * 未確定の入力文字について、自動補完する
 * @param {string[]} suggest_strs 補完文字列の配列
 * @param {string[]} target_class 補完機能適用対象のtextareaのクラス名。指定なければ全てのtextareaに適用
 * @constructor
 */
function AutoCompleteMgr(suggest_strs = [], target_class = []) {
    
    /* 非公開メンバ定義 -------------------------------------------------------------- */
    /**
     * 補完候補全部。初期化や新要素追加以外でいじっちゃだめ。
     */
    let all_suggestions             = {};
    /**
     * 実際に表示する候補一覧
     * 候補に表示するものと、補完文字列をプロパティに持つオブジェクトの配列
     * @type {{suggest: string, comp: string}[]}
     */
    let suggestions                 = [];
    /**
     * textarea内カーソルの座標(stule要素に渡すもの)
     */
    let pos_x                       = ''; 
    /**
     * textarea内カーソルの座標(stule要素に渡すもの)
     */
    let pos_y                       = '';
    /**
     * フォーカスが当たっているtextareaまたはinput
     * @type {HTMLTextAreaElement}
     */
    let focus_textarea              = null;
    /**
     * 候補一覧を開いているか
     */
    let is_display_suggestion_box   = false;

    /* 初期化処理 ------------------------------------------------------------------- */
    for(let suggest of suggest_strs) {
        addSuggestion(suggest);
    }

    // DOM構造の構築完了後に実行します。
    window.addEventListener('DOMContentLoaded', function () {
        initTargetAll();
    });

    /* メンバ関数定義 --------------------------------------------------------------- */


    /**
     * 引数で指定された対象となる全てのtextareaを取得
     * 該当結果がない、target_classが配列ではないときは問答無用でnull
     */
    function _getTargetTextareaCollection() {
        if (!Array.isArray(target_class))               return null;
        let selectors = '';

        for(let i = 0; i < target_class.length; i++) {
            // 文字列以外は追加しない
            if (typeof target_class[i] !== 'string')    continue;
            if (i !== 0)                                selectors += ',';
            selectors += 'textarea.' + target_class[i];
        }
        if (selectors === '')                           return null;
        return document.querySelectorAll(selectors);
    }


    /**
     * 対象となる全てのテキストエリアを初期化する。
     * 引数の指定が不正・なしのときはページに存在する全てのtextareaを初期化する
     */
    function initTargetAll() {
        let textarea_collection = _getTargetTextareaCollection();
        if (textarea_collection === null) {
            textarea_collection = document.getElementsByTagName('textarea');
        }
        if (!textarea_collection.length) return;
        for(let textarea of textarea_collection) {
            init(textarea);
        }
    }


    /**
     * 補完機能を付けるtextareaの初期化。任意要素の追加も可能
     * @param {HTMLTextAreaElement} textarea 初期化対象
     */
    function init(textarea) {
        if (textarea.classList.contains('auto_comp')) return;   // 初期化済みの要素に対して行わない

        /* イベント登録 */
        textarea.addEventListener('focus', () => {
            onFocus(textarea);
        });
        textarea.addEventListener('blur', () => {
            onBlur();
        });

        /* 初期化済みの証 */
        textarea.classList.add('auto_comp');
    }


    /**
     * フォーカスが当たった時の処理
     * @param {HTMLTextAreaElement} textarea
     */
    function onFocus(textarea) {
        focus_textarea  = textarea;
        onMoveSelection();

        focus_textarea.addEventListener('keydown',  priventTextareaEventForSuggetionBox);
        focus_textarea.addEventListener('keyup',    onMoveSelection);
        focus_textarea.addEventListener('click',    onMoveSelection);
    }


    /**
     * フォーカスが外れた時の処理
     */
    function onBlur() {
        focus_textarea.removeEventListener('keydown',   priventTextareaEventForSuggetionBox);
        focus_textarea.removeEventListener('keyup',     onMoveSelection);
        focus_textarea.removeEventListener('click',     onMoveSelection);

        removeSuggestionBox();
        focus_textarea  = null;
    }


    /**
     * textarea内のカーソルに変化が起きたときの処理。
     * 最適化もここで
     * @param {Event} e
     */
    function onMoveSelection(e) {
        if (!focus_textarea) return;
        if (priventTextareaEventForSuggetionBox(e)) return;

        let target_str = '';

        removeSuggestionBox();
        setPos();
        setSearchStr(setTargetStr);
        setSuggestions(target_str);
        displaySuggestionBox();
        
        // コールバック用
        // setSearchStrに直接コールバック書くとtarget_strが認識されなくなるため定義している
        function setTargetStr(before_strs, after_strs) {
            target_str = before_strs[before_strs.length - 1] + after_strs[0];
        }
    }


    /**
     * テキストエリアと候補一覧のイベントがぶつかる時、テキストエリアのイベントを妨害する
     * @param {Event} e
     * @return 妨げたとき、trueを返す
     */
    function priventTextareaEventForSuggetionBox(e) {
        if (is_display_suggestion_box) {
            switch (e.keyCode) {
                case 38:    // up
                case 40:    // down
                case 32:    // Space
                case 13:    // Enter
                case 27:    // Escape
                    e.preventDefault();
                    return true;
            }
        }
        return false;
    }


    /**
     * 入力補完で候補に挙げられる文字列を追加
     * @param {string} suggestion
     */
    function addSuggestion(suggestion) {
        if (typeof suggestion !== 'string' || suggestion === '') return;
        suggestion = suggestion.trim();  // とりま空白消す
        // 配列化する
        if (!all_suggestions[suggestion[0]]) {
             all_suggestions[suggestion[0]] = [];
        }
        all_suggestions[suggestion[0]].push(suggestion);
    }


    /**
     * ポジションをセット
     */
    function setPos() {
        /* 改行・折り返し関係に必要な情報の下準備 -------------------------------- */
        let line_height                 = focus_textarea.clientHeight / focus_textarea.rows;        // styleからは取れなかったので、幅と行数から。行数はデフォルトでも値が入っている
        let area_width                  = focus_textarea.clientWidth;
        let selection_cnt               = focus_textarea.selectionStart;        
        let str_until_selection         = focus_textarea.value.slice(0, selection_cnt - 1);         // キャレット位置は何文字目かということになるので、折り返し時に一回分速くなってしまうため-1
        let temp_array                  = str_until_selection.split(/\r\n|\r|\n/g);                 // キャレットより前にある文字列を改行文字で分割  

        /* 折り返しの数をカウント ---------------------------------------------- */
        let str_length_until_selection  = 0;
        let inner_y_cnt                 = 0;                                                        // 改行を除いた折り返し回数
        for(let temp_str of temp_array) {
            str_length_until_selection  = measureString2(temp_str, focus_textarea, true);
            inner_y_cnt                += Math.floor(str_length_until_selection / area_width);
        }        
        let inner_x_cnt                 = Math.floor(str_length_until_selection / area_width);      // 改行文字とキャレットの間の文字列の折り返し回数

        /* 改行の数取得 ------------------------------------------------------- */    
        let LF_cnt                      = str_until_selection.match(/\r\n|\r|\n/g);                 // 改行のカウント        
        LF_cnt                          = (LF_cnt ? LF_cnt.length : 0);                             // matchは一致結果が無いときnullが返ってくるので、undefine回避処理

        /* 補完候補一覧ボックスの位置 ------------------------------------------- */
        let x = Math.floor((str_length_until_selection -    (inner_x_cnt           * area_width))  + focus_textarea.offsetLeft);
        let y = Math.floor(                                ((inner_y_cnt + LF_cnt) * line_height)  + focus_textarea.offsetTop);
        pos_x = String(x)               + 'px';
        pos_y = String(y + line_height) + 'px';
    }


    /**
     * 候補一覧検索用文字列セット
     * コールバックの引数に渡す
     * @param {(before_strs: string, after_strs: string) => void} callback 個別の処理はコールバックで
     */
    function setSearchStr(callback) {
        const delimiter             = /\r\n|\r|\n|\s|;|:|,|、|。|　|\(|\)|\.|\t|\+|\-|\/|\\/;   //区切り文字 
        let selection_cnt           = focus_textarea.selectionStart;                            // キャレット位置
        let str_before_selection    = focus_textarea.value.slice(0, selection_cnt);
        let str_after_selection     = focus_textarea.value.replace(str_before_selection, '');        
        let before_strs             = str_before_selection.split(delimiter);                    // キャレットの前方にある区切り文字までの文字列
        let after_strs              = str_after_selection.split(delimiter);                     // キャレットの後方にある区切り文字までの文字列

        if (typeof callback !== 'function') return;
        callback(before_strs, after_strs);
    }


    /**
     * 候補一覧文字列をセット
     * @param {string} target_str 検索対象の文字列
     */
    function setSuggestions(target_str) {
        suggestions = [];
        if (!all_suggestions[target_str[0]]) return;
        for(let check of all_suggestions[target_str[0]]) {
            if (check.indexOf(target_str) != -1 && check !== target_str) {
                let comp_str = check.slice(target_str.length);
                suggestions.push({
                    suggest : check,
                    comp    : comp_str
                });
            }
        }
    }


    /**
     * 選択候補の各要素を作成
     * @param {{suggest: string, comp: string}} strs 候補文字列
     */
    function createSuggestionItem(strs) {
        let li      = document.createElement('li');
        let a       = document.createElement('a');
        let text    = document.createTextNode(strs.suggest);
        // マウスダウンのイベント内で必要になるため、クロージャで確保しておく
        let temp_textarea = focus_textarea;

        li.classList.add('suggest_item');
        li.setAttribute('comp', strs.comp);
        a.href          = 'javascript:void(0);';
        
        a.appendChild(text);
        li.appendChild(a);

        // onblurより先に実行されるイベントでないといけないため、onclickではなくonmousedown
        li.onmousedown = onMousedownForSuggestItem;

        /**
         * 候補をクリックしたときのイベント
         */
        function onMousedownForSuggestItem() {
            decidedSuggestionItem(li.getAttribute('comp'), temp_textarea);
    
            // 実行段階でtextareaのフォーカスが外れているか不明
            // どちらにも対応できるようにしている
            if (!focus_textarea) {
                temp_textarea.focus();
            }
            else {
                var event = function() {
                    temp_textarea.removeEventListener('blur', event);
                    temp_textarea.focus();
                }
                temp_textarea.addEventListener('blur', event);
            }
        }
        
        return li;
    }


    /**
     * 選択候補の選択ボックスを作成
     */
    function createSuggestionBox() {
        let div     = document.createElement('div');
        let ul      = document.createElement('ul');

        div.classList.add('suggest_box');
        // いじられたくないため、要素に直書き
        div.style.position = 'absolute';
        div.style.display = 'none';
        ul.classList.add('suggest_list');
        
        for(let strs of suggestions) {
            let li  = createSuggestionItem(strs);
            ul.appendChild(li);
        }
        div.appendChild(ul);

        return div;
    }


    /**
     * 選択候補の表示
     */
    function displaySuggestionBox() {
        let body    = document.getElementsByTagName('body')[0];
        let div     = createSuggestionBox();

        body.appendChild(div);
        // 中身無かったら処理終了
        if (!div.getElementsByTagName('li')[0]) return;

        div.getElementsByTagName('li')[0].classList.add('current_suggest');
        div.style.left = pos_x;
        div.style.top  = pos_y;
        div.style.display = 'block';

        is_display_suggestion_box = true;
        window.addEventListener('keyup', addEventForSuggestionBoxOnKeyup);
    }


    /**
     * 選択候補の削除、その他関連の後処理
     */
    function removeSuggestionBox() {
        let div = document.querySelector('div.suggest_box');

        window.removeEventListener('keyup', addEventForSuggestionBoxOnKeyup);
        is_display_suggestion_box = false;
        // ここに型チェックあるので、divの存在の有無については考えなくてよい
        removeElement(div);
    }


    /**
     * 候補リストボックスのイベント
     * 候補一覧ボックスの中身が空の時の処理はdisplaySuggestionBox()で行われているため、考慮しなくてよい
     * @param {Event} e
     */
    function addEventForSuggestionBoxOnKeyup(e) {

        const current_suggest   = 'current_suggest';
        // ここでselected_itemには必ず値要素が代入されるためチェック不要
        let selected_item       = document.getElementsByClassName(current_suggest)[0];
        let next_item           = null;

        e.preventDefault();
        switch (e.keyCode) {
            case 38:    // up
                changeCurrentSuggestion('prev');
                break;
            case 40:    // down
            case 32:    // Space
                changeCurrentSuggestion('next');
                break;
            case 13:    // Enter
                decidedSuggestionItem(selected_item.getAttribute('comp'), focus_textarea);
            case 27:    // Escape
                removeSuggestionBox();
        }

        /**
         * 選択中の入力候補を切り替える
         * @param {string} trans_direction prev: 一個前の候補へ, 次の候補へ
         */
        function changeCurrentSuggestion(trans_direction) {
            selected_item.classList.remove(current_suggest);
            if (trans_direction === 'prev') next_item = selected_item.previousElementSibling;
            if (trans_direction === 'next') next_item = selected_item.nextElementSibling;
            if (!next_item)                 next_item = selected_item;
            next_item.classList.add(current_suggest);
        }
    }


    /**
     * 候補リスト決定(クリック、enter押下)時の処理
     * @param {string} comp_str 補完する文字列
     * @param {HTMLTextAreaElement} textarea 編集対象のtextarea。実行時にfocus_textareaにアクセスできるか不明のため引数として受け取る
     */
    function decidedSuggestionItem(comp_str, textarea) {
        setSearchStr((not_use, after_strs) => {
            // キャレットの位置を移動
            textarea.selectionStart += after_strs[0].length;
            // 文字挿入処理
            document.execCommand('insertText', false, comp_str);
        });
    }


    /**
     * 文字列の実測値を測定。inline要素で実装
     * @param {string} str 測定したい文字列
     * @param {Element} elem データ取り出すため要素指定
     * @param {bool} is_measure_space 半角スペースも測るか(textareaやpre等のため)
     * @return {number} 測定した長さ, -1の時失敗
     */
    let measureString2 = function() {

        /**
         * 測定用の要素作成
         * 一先ず画面外の領域に配置
         */
        let use_able = false;
        let span = document.createElement('span');
        let text = document.createTextNode('');

        span.appendChild(text);

        span.style.position     = 'fixed';
        span.style.top          = String(window.parent.screen.height) + 'px';
        span.style.margin       = '0';
        span.style.padding      = '0';
        // 改行はさせない
        span.style.whiteSpace   = 'nowrap';
        span.style.display      = 'none';

        // body はdom要素読み込めない限り取得無理
        window.addEventListener('DOMContentLoaded', function () {
            let body = document.getElementsByTagName('body')[0];
            body.appendChild(span);
            use_able = true;
        });

        return function(str = '', elem, is_measure_space = false) {
            if (!use_able)              return -1;
            if (!isElement(elem))       return -1;
            // 長さを測る溜めなので、適当なアルファベットに置き換え
            if (is_measure_space)       str = str.replace(/ /g, 'a');

            let style                   = window.getComputedStyle(elem);

            span.style.display          = 'inline';
            span.style.fontSize         = style.fontSize;
            span.style.fontFamily       = style.fontFamily;
            span.style.letterSpacing    = style.letterSpacing;
            span.style.fontWeight       = style.fontWeight;

            span.textContent            = str;
            let width                   = span.offsetWidth;
            // 後処理
            span.style.display          = 'none';

            return width;
        };
    }();


    /**
     * xml・html要素であるか判定
     * @param {*} obj 判定対象
     * @return true: 要素, false: 要素以外
     */
    function isElement(obj) {
        return obj && obj.nodeType === 1;
    }


    /**
     * 渡した要素を削除します
     * @param {Element} elem 削除したいhtml要素
     * @return true: 成功, false: 失敗
     */
    function removeElement(elem) {
        if (!isElement(elem)) return false;
        elem.parentNode.removeChild(elem);
        return true;
    }


    /* return object --------------------------------------------------------------- */

    return {
        /**
         * 補完機能を付けるtextareaを指定
         * @param textarea 対象要素
         */
        init: init,

        /**
         * 新たに、対象のtextareaが追加された時等機能を適用させる処理
         */
        reLoad: initTargetAll,

        /**
         * 補完内容のついか
         * @param {string} suggest
         */
        addSuggestion: addSuggestion,
    };
}
