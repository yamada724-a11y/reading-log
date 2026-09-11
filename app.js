import { listBooks, getBook, saveBook, deleteBook, createBook, importBooks } from './db.js';
import { KEYS, getSetting, setSetting, searchBooks, MissingKeyError } from './api.js';

const app = document.getElementById('app');

const STATUS = {
  want: '読みたい',
  read: '読んだ',
};

let activeTab = 'want';

/* ---------- DOM helper ---------- */

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') {
      for (const [prop, val] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    } else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const ICONS = {
  add: 'M11 13H5v-2h6V5h2v6h6v2h-6v6h-2z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  bookmark: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z',
  bookmarkFill: 'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z',
  check: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4 8-8z',
  checkFill: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  mic: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z',
  stop: 'M6 6h12v12H6z',
  book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H6V4h2v8l2.5-1.5L13 12V4h5v16z',
};

function icon(name, size = 24) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = h('div', { class: 'toast', text: message });
  document.body.append(node);
  setTimeout(() => node.remove(), 2000);
}

function go(path) {
  location.hash = path;
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/* ---------- Speech ---------- */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeRecognition = null;

const SPEECH_ERRORS = {
  'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定を確認してください。',
  'service-not-allowed': 'この端末では音声入力が使えませんでした。',
  'no-speech': '音声が聞き取れませんでした。',
  network: '通信できませんでした。',
};

/* ---------- Theme ---------- */

function applyTheme() {
  const theme = getSetting(KEYS.theme);
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/* ---------- Cover ---------- */

function paletteOf(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 997;
  return hash % 4;
}

function coverNode(book) {
  if (book.coverUrl) {
    return h('img', { src: book.coverUrl, alt: '', loading: 'lazy' });
  }
  return h('div', {
    class: `book__placeholder ph-${paletteOf(book.title || '?')}`,
    text: book.title,
  });
}

/* ---------- App bar ---------- */

function backButton(onClick) {
  return h('button', { class: 'icon-btn', 'aria-label': 'もどる', onClick }, icon('back'));
}

function bar({ title = '', left, right }) {
  return h('header', { class: 'bar' }, [
    left,
    h('h1', { class: 'bar__title', text: title }),
    right,
  ]);
}

/* ---------- Shelf ---------- */

function bottomNav() {
  return h('nav', { class: 'nav', role: 'tablist' },
    Object.entries(STATUS).map(([key, label]) => {
      const selected = key === activeTab;
      const glyph = key === 'want'
        ? (selected ? 'bookmarkFill' : 'bookmark')
        : (selected ? 'checkFill' : 'check');
      return h('button', {
        class: 'nav__item',
        role: 'tab',
        'aria-selected': String(selected),
        onClick: () => {
          if (selected) return;
          activeTab = key;
          render();
        },
      }, [
        h('div', { class: 'nav__pill' }, icon(glyph)),
        h('span', { class: 'nav__label', text: label }),
      ]);
    })
  );
}

async function viewShelf() {
  const books = await listBooks();
  const shown = books.filter((b) => b.status === activeTab);

  const grid = shown.length
    ? h('div', { class: 'shelf' }, shown.map((book) =>
        h('button', { class: 'book', onClick: () => go(`/book/${book.id}`) }, [
          h('div', { class: 'book__cover' }, coverNode(book)),
          h('p', { class: 'book__title', text: book.title }),
          h('p', { class: 'book__author', text: book.authors.join('、') }),
        ])
      ))
    : h('div', { class: 'empty' }, [
        h('div', { class: 'empty__icon' }, icon('book', 28)),
        h('p', {
          class: 'empty__text',
          text: activeTab === 'want' ? 'まだ登録がありません' : 'まだ読み終えた本がありません',
        }),
      ]);

  return [
    bar({
      title: '読書記録',
      right: h('button', { class: 'icon-btn', 'aria-label': '設定', onClick: () => go('/settings') }, icon('tune')),
    }),
    h('main', {}, grid),
    h('button', { class: 'fab', 'aria-label': '本を追加', onClick: () => go('/new') }, icon('add', 28)),
    bottomNav(),
  ];
}

/* ---------- Add: search ---------- */

async function addFromCandidate(candidate) {
  const book = createBook({ ...candidate, status: activeTab });
  await saveBook(book);
  toast(`${STATUS[activeTab]}に追加しました`);
  go(`/book/${book.id}`);
}

function viewSearch() {
  let controller;

  const status = h('p', { class: 'search__status' });
  const results = h('div', { class: 'results' });

  const input = h('input', {
    type: 'search',
    placeholder: 'タイトルで探す',
    enterkeyhint: 'search',
    autocomplete: 'off',
    onKeyDown: (e) => {
      if (e.key === 'Enter') search();
    },
  });

  async function search() {
    const query = input.value.trim();
    if (!query) return;
    input.blur();
    controller?.abort();
    controller = new AbortController();
    results.replaceChildren();
    status.textContent = '検索中…';

    try {
      const candidates = await searchBooks(query, { signal: controller.signal });
      if (!candidates.length) {
        status.textContent = '見つかりませんでした。別の言葉でも試してみてください。';
        return;
      }
      status.textContent = '';
      results.replaceChildren(...candidates.map((candidate) =>
        h('button', { class: 'result', onClick: () => addFromCandidate(candidate) }, [
          h('div', { class: 'result__cover' }, coverNode(candidate)),
          h('div', { class: 'result__body' }, [
            h('p', { class: 'result__title', text: candidate.title }),
            h('p', { class: 'result__meta', text: candidate.authors.join('、') }),
            h('p', {
              class: 'result__meta result__meta--fine',
              text: [candidate.publisher, candidate.pubdate && `${candidate.pubdate}年`].filter(Boolean).join(' / '),
            }),
          ]),
        ])
      ));
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error instanceof MissingKeyError) {
        status.replaceChildren(
          '楽天APIのキーが未設定です。',
          h('button', { class: 'link', text: '設定を開く', onClick: () => go('/settings') })
        );
        return;
      }
      status.textContent = error.message;
    }
  }

  status.textContent = `タップすると「${STATUS[activeTab]}」に追加します。あとから変更できます。`;
  setTimeout(() => input.focus(), 50);

  return [
    bar({
      title: '本を追加',
      left: backButton(() => go('/')),
      right: h('button', { class: 'text-btn', text: '手入力', onClick: () => go('/manual') }),
    }),
    h('main', {}, [
      h('div', { class: 'search' }, [
        input,
        h('button', { class: 'search__go', text: '検索', onClick: search }),
      ]),
      status,
      results,
    ]),
  ];
}

/* ---------- Add / edit: manual form ---------- */

async function viewForm(id) {
  const editing = Boolean(id);
  const book = editing ? await getBook(id) : createBook({ status: activeTab });
  if (!book) return viewMissing();

  const draft = { ...book, authors: [...book.authors] };
  let submit;

  const titleInput = h('input', {
    type: 'text',
    value: draft.title,
    placeholder: '例：夜は短し歩けよ乙女',
    onInput: (e) => {
      draft.title = e.target.value.trim();
      submit.disabled = !draft.title;
    },
  });

  const statusPills = h('div', { class: 'pills' },
    Object.entries(STATUS).map(([key, label]) =>
      h('button', {
        class: 'pill',
        'aria-pressed': String(key === draft.status),
        text: label,
        onClick: (e) => {
          draft.status = key;
          for (const pill of e.currentTarget.parentElement.children) {
            pill.setAttribute('aria-pressed', String(pill === e.currentTarget));
          }
        },
      })
    )
  );

  const save = async () => {
    if (!draft.title) return;
    await saveBook(draft);
    activeTab = draft.status;
    toast(editing ? '保存しました' : '本棚に追加しました');
    go(`/book/${draft.id}`);
  };

  submit = h('button', {
    class: 'btn',
    text: editing ? '保存する' : '本棚に追加',
    disabled: !draft.title,
    onClick: save,
  });

  return [
    bar({
      title: editing ? '書誌を編集' : '手入力で追加',
      left: backButton(() => history.back()),
    }),
    h('main', {}, [
      h('div', { class: 'card' }, [
        h('div', { class: 'field' }, [
          h('label', { class: 'field__label', text: 'タイトル' }),
          titleInput,
        ]),
        h('div', { class: 'field' }, [
          h('label', { class: 'field__label', text: '著者（複数いる場合は読点で区切る）' }),
          h('input', {
            type: 'text',
            value: draft.authors.join('、'),
            onInput: (e) => {
              draft.authors = e.target.value.split(/[、,]/).map((s) => s.trim()).filter(Boolean);
            },
          }),
        ]),
        h('div', { class: 'field' }, [
          h('label', { class: 'field__label', text: '出版社' }),
          h('input', {
            type: 'text',
            value: draft.publisher,
            onInput: (e) => { draft.publisher = e.target.value.trim(); },
          }),
        ]),
        h('div', { class: 'field' }, [
          h('label', { class: 'field__label', text: '出版年' }),
          h('input', {
            type: 'text',
            inputmode: 'numeric',
            value: draft.pubdate,
            placeholder: '2008',
            onInput: (e) => { draft.pubdate = e.target.value.trim(); },
          }),
        ]),
        h('div', { class: 'field', style: { marginBottom: '0' } }, [
          h('label', { class: 'field__label', text: 'どちらに入れる？' }),
          statusPills,
        ]),
      ]),
      submit,
    ]),
  ];
}

/* ---------- Detail ---------- */

async function viewDetail(id) {
  const book = await getBook(id);
  if (!book) return viewMissing();

  let saveTimer;
  const savedNote = h('p', { class: 'saved' });

  const queueSave = (patch) => {
    Object.assign(book, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await saveBook(book);
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      savedNote.textContent = `${time} に自動保存しました`;
    }, 700);
  };

  const rating = h('div', { class: 'rating' },
    [1, 2, 3, 4, 5].map((value) =>
      h('button', {
        class: 'rating__star',
        'aria-label': `${value}点`,
        'aria-pressed': String(value <= book.rating),
        onClick: (e) => {
          const next = book.rating === value ? 0 : value;
          for (const star of e.currentTarget.parentElement.children) {
            star.setAttribute('aria-pressed', String(Number(star.getAttribute('aria-label')[0]) <= next));
          }
          queueSave({ rating: next });
        },
      }, icon('star'))
    )
  );

  const statusPills = h('div', { class: 'pills' },
    Object.entries(STATUS).map(([key, label]) =>
      h('button', {
        class: 'pill',
        'aria-pressed': String(key === book.status),
        text: label,
        onClick: (e) => {
          for (const pill of e.currentTarget.parentElement.children) {
            pill.setAttribute('aria-pressed', String(pill === e.currentTarget));
          }
          activeTab = key;
          queueSave({ status: key });
        },
      })
    )
  );

  const dateInput = h('input', {
    type: 'date',
    value: book.finishedAt,
    onChange: (e) => queueSave({ finishedAt: e.target.value }),
  });

  const noteArea = h('textarea', {
    rows: '8',
    placeholder: '読んで思ったことを書く',
    onInput: (e) => writeNote(e.target.value),
  }, book.note);

  function writeNote(value) {
    const patch = { note: value };
    if (value.trim() && !book.finishedAt) {
      patch.finishedAt = todayISO();
      dateInput.value = patch.finishedAt;
    }
    queueSave(patch);
  }

  const micButton = SpeechRecognition && h('button', {
    class: 'tonal',
    onClick: () => (activeRecognition ? activeRecognition.stop() : listen()),
  }, [icon('mic', 20), h('span', { text: '音声で入力' })]);

  function setMicState(live) {
    micButton.classList.toggle('tonal--live', live);
    micButton.replaceChildren(
      icon(live ? 'stop' : 'mic', 20),
      h('span', { text: live ? '聞いています…' : '音声で入力' })
    );
  }

  function listen() {
    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = false;

    const base = noteArea.value;
    const separator = base && !/\s$/.test(base) ? '\n' : '';

    recognition.onstart = () => {
      activeRecognition = recognition;
      setMicState(true);
      savedNote.textContent = '';
    };
    recognition.onresult = (event) => {
      const spoken = [...event.results].map((result) => result[0].transcript).join('');
      noteArea.value = base + separator + spoken;
      noteArea.scrollTop = noteArea.scrollHeight;
      if (event.results[event.results.length - 1].isFinal) writeNote(noteArea.value);
    };
    recognition.onerror = (event) => {
      savedNote.textContent = SPEECH_ERRORS[event.error] || '音声入力に失敗しました。';
    };
    recognition.onend = () => {
      activeRecognition = null;
      setMicState(false);
    };
    recognition.start();
  }

  const subtitle = [book.authors.join('、'), book.publisher].filter(Boolean).join(' / ');

  return [
    bar({
      left: backButton(() => go('/')),
      right: h('button', { class: 'text-btn', text: '編集', onClick: () => go(`/edit/${book.id}`) }),
    }),
    h('main', {}, [
      h('div', { class: 'detail__head' }, [
        h('div', { class: 'detail__cover' }, coverNode(book)),
        h('div', { class: 'detail__meta' }, [
          h('h2', { class: 'detail__title', text: book.title }),
          subtitle && h('p', { class: 'detail__sub', text: subtitle }),
          book.pubdate && h('p', { class: 'detail__sub detail__sub--fine', text: `${book.pubdate} 年` }),
        ]),
      ]),
      h('div', { class: 'card' }, [
        h('p', { class: 'card__label', text: 'どちらに入れる？' }),
        statusPills,
      ]),
      h('div', { class: 'card' }, [
        h('p', { class: 'card__label', text: '評価' }),
        rating,
      ]),
      h('div', { class: 'card' }, [
        h('p', { class: 'card__label', text: '感想' }),
        noteArea,
        micButton,
        savedNote,
      ]),
      h('div', { class: 'card' }, [
        h('p', { class: 'card__label', text: '読了日' }),
        dateInput,
        h('p', { class: 'field__note', text: '感想を書くと、その日の日付が自動で入ります。' }),
      ]),
      h('button', {
        class: 'btn btn--quiet',
        text: 'この本を削除',
        onClick: async () => {
          if (!confirm(`「${book.title}」を削除します。よろしいですか？`)) return;
          await deleteBook(book.id);
          toast('削除しました');
          go('/');
        },
      }),
    ]),
  ];
}

/* ---------- Settings ---------- */

function viewSettings() {
  const appIdInput = h('input', {
    type: 'password',
    value: getSetting(KEYS.rakutenAppId),
    autocomplete: 'off',
    placeholder: 'アプリケーションID',
  });

  const accessKeyInput = h('input', {
    type: 'password',
    value: getSetting(KEYS.rakutenAccessKey),
    autocomplete: 'off',
    placeholder: 'アクセスキー',
  });

  const reveal = h('button', {
    class: 'link',
    text: '表示する',
    onClick: () => {
      const hidden = appIdInput.type === 'password';
      for (const field of [appIdInput, accessKeyInput]) field.type = hidden ? 'text' : 'password';
      reveal.textContent = hidden ? '隠す' : '表示する';
    },
  });

  const themes = { '': '自動', light: '明るい', dark: '暗い' };
  const themePills = h('div', { class: 'pills' },
    Object.entries(themes).map(([key, label]) =>
      h('button', {
        class: 'pill',
        'aria-pressed': String(key === getSetting(KEYS.theme)),
        text: label,
        onClick: (e) => {
          for (const pill of e.currentTarget.parentElement.children) {
            pill.setAttribute('aria-pressed', String(pill === e.currentTarget));
          }
          setSetting(KEYS.theme, key);
          applyTheme();
        },
      })
    )
  );

  return [
    bar({
      title: '設定',
      left: backButton(() => go('/')),
      right: h('button', {
        class: 'text-btn',
        text: '保存',
        onClick: () => {
          setSetting(KEYS.rakutenAppId, appIdInput.value.trim());
          setSetting(KEYS.rakutenAccessKey, accessKeyInput.value.trim());
          toast('保存しました');
          go('/');
        },
      }),
    }),
    h('main', {}, [
      h('div', { class: 'card' }, [
        h('p', { class: 'card__label', text: '楽天ブックスAPI' }),
        h('div', { class: 'field' }, appIdInput),
        h('div', { class: 'field', style: { marginBottom: '0' } }, [
          accessKeyInput,
          h('p', { class: 'field__note' }, [
            'タイトル検索と表紙の取得に使います。どちらもこの端末の中だけに保存され、外部には送られません。　',
            reveal,
          ]),
        ]),
      ]),
      backupCard(),
      h('div', { class: 'card' }, [
        h('p', { class: 'card__label', text: '画面の明るさ' }),
        themePills,
      ]),
    ]),
  ];
}

/* ---------- Backup ---------- */

const DAY = 24 * 60 * 60 * 1000;

function backupCard() {
  const lastBackupAt = getSetting(KEYS.lastBackupAt);
  const stale = !lastBackupAt || Date.now() - Date.parse(lastBackupAt) > 30 * DAY;

  const state = h('p', {
    class: 'field__note',
    text: lastBackupAt
      ? `最後に書き出したのは ${lastBackupAt.slice(0, 10)} です。`
      : 'まだ一度も書き出していません。',
  });

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onChange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        if (payload?.schema !== 'readinglog.v1' || !Array.isArray(payload.books)) {
          throw new Error('このアプリのバックアップではないようです。');
        }
        const { added, updated, skipped } = await importBooks(payload.books);
        toast(`${added}冊を追加、${updated}冊を更新しました`);
        state.textContent = `読み戻しました（追加${added} / 更新${updated} / 変更なし${skipped}）`;
      } catch (error) {
        state.textContent = `読み戻せませんでした：${error.message}`;
      } finally {
        e.target.value = '';
      }
    },
  });

  const exportNow = async () => {
    const books = await listBooks();
    const payload = {
      schema: 'readinglog.v1',
      exportedAt: new Date().toISOString(),
      books,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' }));
    const link = h('a', { href: url, download: `読書記録-${todayISO()}.json` });
    link.click();
    URL.revokeObjectURL(url);
    setSetting(KEYS.lastBackupAt, new Date().toISOString());
    state.textContent = `${books.length}冊を書き出しました。`;
    toast('書き出しました');
  };

  return h('div', { class: 'card' }, [
    h('p', { class: 'card__label', text: 'バックアップ' }),
    h('button', { class: 'btn', text: 'ファイルに書き出す', onClick: exportNow }),
    h('button', {
      class: 'tonal',
      style: { width: '100%', justifyContent: 'center', marginTop: 'var(--s3)' },
      text: 'ファイルから読み戻す',
      onClick: () => fileInput.click(),
    }),
    fileInput,
    state,
    stale && h('p', { class: 'field__note warn', text: '記録はこの端末の中にしかありません。機種変更やブラウザのデータ削除で消えるため、ときどき書き出してください。' }),
    h('p', { class: 'field__note', text: 'APIキーはバックアップに含まれません。' }),
  ]);
}

function viewMissing() {
  return [
    bar({ left: backButton(() => go('/')) }),
    h('main', {}, h('div', { class: 'empty' }, [
      h('div', { class: 'empty__icon' }, icon('book', 28)),
      h('p', { class: 'empty__text', text: 'この本は見つかりませんでした' }),
    ])),
  ];
}

/* ---------- Router ---------- */

async function render() {
  activeRecognition?.abort();
  const path = location.hash.slice(1) || '/';
  const [, section, param] = path.split('/');

  let nodes;
  if (section === 'book' && param) nodes = await viewDetail(param);
  else if (section === 'edit' && param) nodes = await viewForm(param);
  else if (section === 'manual') nodes = await viewForm(null);
  else if (section === 'new') nodes = viewSearch();
  else if (section === 'settings') nodes = viewSettings();
  else nodes = await viewShelf();

  app.replaceChildren(...[].concat(nodes));
  window.scrollTo(0, 0);
}

applyTheme();
window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

navigator.storage?.persist?.();
