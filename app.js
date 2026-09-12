import { listBooks, getBook, saveBook, deleteBook, createBook, importBooks } from './db.js';
import {
  KEYS,
  getSetting,
  setSetting,
  searchBooks,
  fetchLibraries,
  getLibraries,
  setLibraries,
  checkAvailability,
  MissingKeyError,
} from './api.js';

const app = document.getElementById('app');

const STATUS = {
  want: '読みたい',
  read: '読んだ',
};

let activeTab = 'want';
let searchBy = 'title';

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
  backup: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3zM8 13h2.55v3h2.9v-3H16l-4-4z',
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
    ...[].concat(right),
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
      right: [
        h('button', {
          class: `icon-btn${backupIsStale() ? ' icon-btn--dot' : ''}`,
          'aria-label': 'バックアップ',
          title: 'バックアップ',
          onClick: async (e) => {
            const button = e.currentTarget;
            if (await runBackup(books) !== null) button.classList.remove('icon-btn--dot');
          },
        }, icon('backup')),
        h('button', { class: 'icon-btn', 'aria-label': '設定', onClick: () => go('/settings') }, icon('tune')),
      ],
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

const SEARCH_BY = {
  title: { label: 'タイトル', placeholder: 'タイトルで探す' },
  author: { label: '著者', placeholder: '著者名で探す' },
};

function viewSearch() {
  let controller;

  const status = h('p', { class: 'search__status' });
  const results = h('div', { class: 'results' });

  const input = h('input', {
    type: 'search',
    placeholder: SEARCH_BY[searchBy].placeholder,
    enterkeyhint: 'search',
    autocomplete: 'off',
    onKeyDown: (e) => {
      if (e.key === 'Enter') search();
    },
  });

  const byPills = h('div', { class: 'pills search-by' },
    Object.entries(SEARCH_BY).map(([key, { label }]) =>
      h('button', {
        class: 'pill',
        'aria-pressed': String(key === searchBy),
        text: label,
        onClick: (e) => {
          searchBy = key;
          for (const pill of e.currentTarget.parentElement.children) {
            pill.setAttribute('aria-pressed', String(pill === e.currentTarget));
          }
          input.placeholder = SEARCH_BY[key].placeholder;
          if (input.value.trim()) search();
          else input.focus();
        },
      })
    )
  );

  async function search() {
    const query = input.value.trim();
    if (!query) return;
    input.blur();
    controller?.abort();
    controller = new AbortController();
    results.replaceChildren();
    status.textContent = '検索中…';

    try {
      const candidates = await searchBooks(query, { by: searchBy, signal: controller.signal });
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
    }),
    h('main', {}, [
      byPills,
      h('div', { class: 'search' }, [
        input,
        h('button', { class: 'search__go', text: '検索', onClick: search }),
      ]),
      status,
      results,
    ]),
  ];
}

/* ---------- Edit ---------- */

async function viewForm(id) {
  const book = await getBook(id);
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
    toast('保存しました');
    go(`/book/${draft.id}`);
  };

  submit = h('button', {
    class: 'btn',
    text: '保存する',
    disabled: !draft.title,
    onClick: save,
  });

  return [
    bar({
      title: '書誌を編集',
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
      libraryCard(book),
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

function libraryCard(book) {
  const systems = getLibraries();
  const label = h('p', { class: 'card__label', text: '図書館' });

  if (!book.isbn13) {
    return h('div', { class: 'card' }, [
      label,
      h('p', { class: 'field__note', text: 'この本にはISBNが登録されていないため、蔵書を調べられません。検索から登録し直すと調べられるようになります。' }),
    ]);
  }

  if (!systems.length) {
    return h('div', { class: 'card' }, [
      label,
      h('p', { class: 'field__note' }, [
        '調べたい図書館がまだ選ばれていません。　',
        h('button', { class: 'link', text: '設定で選ぶ', onClick: () => go('/settings') }),
      ]),
    ]);
  }

  const status = h('p', { class: 'field__note' });
  const results = h('div', {});

  const draw = (books) => {
    results.replaceChildren(...systems.map((system) => availabilityNode(system, books[system.systemid] || {})));
  };

  const button = h('button', {
    class: 'tonal',
    style: { width: '100%', justifyContent: 'center' },
    text: '蔵書を調べる',
    onClick: async () => {
      button.disabled = true;
      status.textContent = '図書館に問い合わせています…（十数秒かかることがあります）';
      try {
        const found = await checkAvailability(book.isbn13, systems.map((s) => s.systemid), { onProgress: draw });
        draw(found);
        status.textContent = '';
      } catch (error) {
        if (error instanceof MissingKeyError) {
          status.replaceChildren(
            'カーリルのアプリケーションキーが未設定です。',
            h('button', { class: 'link', text: '設定を開く', onClick: () => go('/settings') })
          );
        } else if (error.name !== 'AbortError') {
          status.textContent = error.message;
        }
      } finally {
        button.disabled = false;
      }
    },
  });

  return h('div', { class: 'card' }, [label, button, status, results]);
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

  const calilInput = h('input', {
    type: 'text',
    value: getSetting(KEYS.calilAppKey),
    autocomplete: 'off',
    placeholder: 'カーリルのアプリケーションキー',
  });

  const chosenLibraries = getLibraries();

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
          setSetting(KEYS.calilAppKey, calilInput.value.trim());
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
      h('div', { class: 'card' }, [
        h('p', { class: 'card__label', text: '図書館（カーリル）' }),
        h('div', { class: 'field' }, calilInput),
        h('button', {
          class: 'tonal',
          style: { width: '100%', justifyContent: 'center' },
          text: chosenLibraries.length ? `図書館を選び直す（${chosenLibraries.length}件）` : '図書館を選ぶ',
          onClick: () => {
            setSetting(KEYS.calilAppKey, calilInput.value.trim());
            go('/libraries');
          },
        }),
        chosenLibraries.length
          ? h('p', { class: 'field__note', text: chosenLibraries.map((item) => item.name).join('、') })
          : h('p', { class: 'field__note', text: '読みたい本が置いてあるか調べたい図書館を選びます。' }),
      ]),
      backupCard(),
      h('div', { class: 'card' }, [
        h('p', { class: 'card__label', text: '画面の明るさ' }),
        themePills,
      ]),
    ]),
  ];
}

/* ---------- Libraries ---------- */

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

function viewLibraries() {
  let libraries = [];
  let chosen = getLibraries();

  const status = h('p', { class: 'field__note' });
  const list = h('div', {});

  const citySelect = h('select', {
    disabled: true,
    onChange: () => renderList(),
  }, h('option', { value: '', text: 'すべての市区町村' }));

  const prefSelect = h('select', { onChange: () => loadPref(prefSelect.value) }, [
    h('option', { value: '', text: '都道府県を選ぶ' }),
    ...PREFECTURES.map((name) => h('option', { value: name, text: name })),
  ]);

  function renderList() {
    const city = citySelect.value;
    const shown = city ? libraries.filter((lib) => lib.city === city) : libraries;

    const systems = new Map();
    for (const lib of shown) {
      if (!systems.has(lib.systemid)) {
        systems.set(lib.systemid, { systemid: lib.systemid, name: lib.systemname, branches: [] });
      }
      systems.get(lib.systemid).branches.push(lib.short || lib.formal);
    }

    status.textContent = `${systems.size}件の図書館システムが見つかりました。`;
    list.replaceChildren(...[...systems.values()].map((system) => {
      const selected = chosen.some((item) => item.systemid === system.systemid);
      return h('button', {
        class: 'lib',
        'aria-pressed': String(selected),
        onClick: (e) => {
          const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
          chosen = on
            ? chosen.filter((item) => item.systemid !== system.systemid)
            : [...chosen, { systemid: system.systemid, name: system.name }];
          setLibraries(chosen);
          e.currentTarget.setAttribute('aria-pressed', String(!on));
        },
      }, [
        h('div', { class: 'lib__body' }, [
          h('p', { class: 'lib__name', text: system.name }),
          h('p', { class: 'lib__branches', text: system.branches.slice(0, 6).join('、') }),
        ]),
        h('div', { class: 'lib__mark' }, icon('checkFill', 22)),
      ]);
    }));
  }

  async function loadPref(pref) {
    list.replaceChildren();
    citySelect.disabled = true;
    if (!pref) {
      status.textContent = '';
      return;
    }
    status.textContent = '読み込んでいます…';
    try {
      libraries = await fetchLibraries(pref);
      const cities = [...new Set(libraries.map((lib) => lib.city).filter(Boolean))].sort();
      citySelect.replaceChildren(
        h('option', { value: '', text: 'すべての市区町村' }),
        ...cities.map((city) => h('option', { value: city, text: city }))
      );
      citySelect.disabled = false;
      renderList();
    } catch (error) {
      if (error instanceof MissingKeyError) {
        status.replaceChildren(
          'カーリルのアプリケーションキーが未設定です。',
          h('button', { class: 'link', text: '設定を開く', onClick: () => go('/settings') })
        );
        return;
      }
      status.textContent = error.message;
    }
  }

  return [
    bar({ title: '図書館を選ぶ', left: backButton(() => go('/settings')) }),
    h('main', {}, [
      h('div', { class: 'card' }, [
        h('div', { class: 'field' }, prefSelect),
        h('div', { class: 'field', style: { marginBottom: '0' } }, citySelect),
      ]),
      status,
      list,
    ]),
  ];
}

const SHELF_STATUS = {
  貸出可: 'ok',
  蔵書あり: 'ok',
  館内のみ: 'ok',
  貸出中: 'busy',
  予約中: 'busy',
  準備中: 'busy',
  休館中: 'busy',
};

function availabilityNode(system, result) {
  const branches = Object.entries(result.libkey || {});
  const values = branches.map(([, value]) => value);

  let badge = { text: '蔵書なし', tone: 'none' };
  if (values.some((value) => SHELF_STATUS[value] === 'ok')) badge = { text: '借りられます', tone: 'ok' };
  else if (values.length) badge = { text: '貸出中', tone: 'busy' };
  if (result.status === 'Running') badge = { text: '確認中…', tone: 'none' };

  return h('div', { class: 'avail' }, [
    h('div', { class: 'avail__head' }, [
      h('p', { class: 'avail__name', text: system.name }),
      h('span', { class: `badge badge--${badge.tone}`, text: badge.text }),
    ]),
    branches.length && h('p', {
      class: 'avail__branches',
      text: branches.map(([name, value]) => `${name}：${value}`).join(' / '),
    }),
    result.reserveurl && h('a', {
      class: 'link',
      href: result.reserveurl,
      target: '_blank',
      rel: 'noopener',
      text: '図書館のページを開く',
    }),
  ]);
}

/* ---------- Backup ---------- */

const DAY = 24 * 60 * 60 * 1000;

function backupIsStale() {
  const lastBackupAt = getSetting(KEYS.lastBackupAt);
  return !lastBackupAt || Date.now() - Date.parse(lastBackupAt) > 30 * DAY;
}

/* スマホでは共有メニューを開き、Googleドライブなどへ直接保存できるようにする。
   AndroidのChromeは .json を共有できないため、そのときは .txt で渡す（中身は同じJSON）。 */
async function deliverFile(text, basename) {
  if (navigator.canShare && matchMedia('(pointer: coarse)').matches) {
    for (const [ext, type] of [['json', 'application/json'], ['txt', 'text/plain']]) {
      const file = new File([text], `${basename}.${ext}`, { type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  h('a', { href: url, download: `${basename}.json` }).click();
  URL.revokeObjectURL(url);
}

/* 共有メニューはタップ直後でないと開けないため、読み込み済みの本があれば渡してもらう。
   成功したら冊数、キャンセル・失敗なら null を返す。 */
async function runBackup(books) {
  try {
    const all = books || await listBooks();
    const payload = {
      schema: 'readinglog.v1',
      exportedAt: new Date().toISOString(),
      books: all,
    };
    await deliverFile(JSON.stringify(payload, null, 1), `読書記録-${todayISO()}`);
    setSetting(KEYS.lastBackupAt, new Date().toISOString());
    toast(`${all.length}冊をバックアップしました`);
    return all.length;
  } catch (error) {
    if (error.name !== 'AbortError') toast('バックアップできませんでした');
    return null;
  }
}

function backupCard() {
  const lastBackupAt = getSetting(KEYS.lastBackupAt);

  const state = h('p', {
    class: 'field__note',
    text: lastBackupAt
      ? `最後にバックアップしたのは ${lastBackupAt.slice(0, 10)} です。`
      : 'まだ一度もバックアップしていません。',
  });

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json,text/plain,.txt',
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
    const count = await runBackup();
    if (count !== null) state.textContent = `${count}冊をバックアップしました。`;
  };

  return h('div', { class: 'card' }, [
    h('p', { class: 'card__label', text: 'バックアップ' }),
    h('button', { class: 'btn', text: 'バックアップする', onClick: exportNow }),
    h('p', { class: 'field__note', text: 'スマホでは共有メニューが開きます。「ドライブ」を選ぶとGoogleドライブに保存されます。' }),
    h('button', {
      class: 'tonal',
      style: { width: '100%', justifyContent: 'center', marginTop: 'var(--s3)' },
      text: 'ファイルから読み戻す',
      onClick: () => fileInput.click(),
    }),
    fileInput,
    state,
    backupIsStale() && h('p', { class: 'field__note warn', text: '記録はこの端末の中にしかありません。機種変更やブラウザのデータ削除で消えるため、ときどき保存してください。' }),
    h('p', { class: 'field__note', text: '機種変更や、別のスマホに記録を移すときは、保存したファイルを「ファイルから読み戻す」で取り込みます。同じ本は新しいほうの記録が残ります。APIキーはバックアップに含まれません。' }),
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
  else if (section === 'new') nodes = viewSearch();
  else if (section === 'settings') nodes = viewSettings();
  else if (section === 'libraries') nodes = viewLibraries();
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
