    window.addEventListener('DOMContentLoaded', function () {
      const iconObserverOptions = { childList: true, subtree: true };
      let iconObserver = null;
      const renderIcons = () => {
        if (!window.lucide) return;
        // Lucide replaces <i data-lucide> nodes with SVG nodes. Temporarily
        // disconnect so those internal replacements cannot recursively trigger
        // this observer and block the browser's main thread.
        iconObserver?.disconnect();
        window.lucide.createIcons();
        iconObserver?.observe(document.body, iconObserverOptions);
      };

      // Re-render icons inserted by dynamic search and form states.
      iconObserver = new MutationObserver((mutations) => {
        const hasNewIcon = mutations.some((mutation) =>
          Array.from(mutation.addedNodes).some((node) =>
            node.nodeType === 1 &&
            (node.matches?.('i[data-lucide]') || node.querySelector?.('i[data-lucide]'))
          )
        );
        if (hasNewIcon) renderIcons();
      });
      renderIcons();
    });
