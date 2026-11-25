'use strict';

// A To / Cc / Bcc field that turns addresses into chips, like mentions in a chat
// app. Type or paste addresses; comma, semicolon, Enter, Tab or leaving the
// field makes a chip. Backspace on an empty field removes the last one.
App.recipients = (() => {
  const { h } = App.dom;
  const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

  // "Ada <ada@x.org>, bob@y.com" -> [{ name: 'Ada', address: 'ada@x.org' }, { name: '', address: 'bob@y.com' }]
  function parse(text) {
    return String(text)
      .split(/[,;\n]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const m = part.match(/^(.*)<([^>]+)>\s*$/);
        if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2].trim() };
        return { name: '', address: part.replace(/^mailto:/i, '') };
      });
  }

  function create(container, { onChange = () => {} } = {}) {
    let list = []; // { name, address }
    const input = h('input', {
      id: `${container.id}Input`,
      class: 'recipient-input',
      type: 'text',
      spellcheck: 'false',
      'aria-label': container.id.replace(/^c/, '')
    });

    function render() {
      const chips = list.map((r, i) =>
        h('span', { class: ADDRESS.test(r.address) ? 'rchip' : 'rchip is-invalid', title: r.address }, [
          h('span', { class: 'rchip-name', text: r.name || r.address }),
          h('button', {
            type: 'button',
            class: 'rchip-x',
            'aria-label': `Remove ${r.address}`,
            onclick: () => {
              list.splice(i, 1);
              render();
              onChange();
              input.focus();
            }
          }, App.icons.svg('close'))
        ])
      );
      // Chips go in front of the input without moving it, so typing keeps focus.
      if (input.parentNode !== container) container.append(input);
      container.querySelectorAll('.rchip').forEach((n) => n.remove());
      input.before(...chips);
      input.placeholder = list.length ? '' : 'Add people';
    }

    function add(entries) {
      const seen = new Set(list.map((r) => r.address.toLowerCase()));
      for (const r of entries) {
        const key = r.address.toLowerCase();
        if (!r.address || seen.has(key)) continue;
        seen.add(key);
        list.push(r);
      }
    }

    // Turns whatever is typed into chips. Returns false if nothing changed.
    function commit() {
      const text = input.value;
      if (!text.trim()) return false;
      input.value = '';
      add(parse(text));
      render();
      onChange();
      return true;
    }

    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && input.value.trim())) && !e.isComposing) {
        if (commit() || e.key !== 'Tab') e.preventDefault();
      } else if (e.key === 'Backspace' && !input.value && list.length) {
        list.pop();
        render();
        onChange();
      }
    });
    input.addEventListener('paste', (e) => {
      const text = e.clipboardData.getData('text');
      if (!/[,;\n]/.test(text)) return;
      e.preventDefault();
      input.value += text;
      commit();
    });
    input.addEventListener('blur', commit);
    container.addEventListener('click', (e) => {
      if (e.target === container) input.focus();
    });

    render();
    return {
      input,
      commit,
      focus: () => input.focus(),
      get: () => list.map((r) => ({ ...r })),
      addresses: () => list.map((r) => r.address),
      invalid: () => list.filter((r) => !ADDRESS.test(r.address)).map((r) => r.address),
      set(entries) {
        list = [];
        input.value = '';
        add(entries || []);
        render();
      }
    };
  }

  return { create, parse, isAddress: (a) => ADDRESS.test(a) };
})();
