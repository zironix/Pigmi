import { evaluateArithmetic } from '../../utils/arithmetic';

export const uiMethods = {
  evaluateInput(expression) {
    const value = evaluateArithmetic(expression);
    return value === null ? expression : Math.round(value);
  },
  isTabActive(tab) {
    if (tab === 'item' || tab === 'search') {
      return this.isItemSearchSplitVisible || this.current_tab === tab;
    }
    return !this.isItemSearchSplitVisible && this.current_tab === tab;
  },
  handleTabClick(tab) {
    if (tab === 'item') {
      if (this.selected === false) return;
      const fromOtherTab =
        this.current_tab !== 'item' &&
        this.current_tab !== 'search' &&
        !this.isItemSearchSplitVisible;
      if (fromOtherTab && this.lastItemSearchState === 'split') {
        this.isItemSearchSplitVisible = true;
        this.current_tab = 'item';
        this.lastItemSearchState = 'split';
        return;
      }
      if (this.isItemSearchSplitVisible) {
        this.isItemSearchSplitVisible = false;
        this.current_tab = 'search';
        this.lastItemSearchState = 'search';
        return;
      }
      if (this.current_tab === 'search') {
        this.isItemSearchSplitVisible = true;
        this.lastItemSearchState = 'split';
        return;
      }
      this.current_tab = 'item';
      this.lastItemSearchState = 'item';
      return;
    }

    if (tab === 'search') {
      const fromOtherTab =
        this.current_tab !== 'item' &&
        this.current_tab !== 'search' &&
        !this.isItemSearchSplitVisible;
      if (fromOtherTab && this.lastItemSearchState === 'split' && this.selected !== false) {
        this.isItemSearchSplitVisible = true;
        this.current_tab = 'search';
        this.lastItemSearchState = 'split';
        return;
      }
      if (this.isItemSearchSplitVisible) {
        this.isItemSearchSplitVisible = false;
        this.current_tab = 'item';
        this.lastItemSearchState = 'item';
        return;
      }
      if (this.current_tab === 'item' && this.selected !== false) {
        this.isItemSearchSplitVisible = true;
        this.lastItemSearchState = 'split';
        return;
      }
      this.current_tab = 'search';
      // Viewing an empty Layers panel does not close the default Geometry panel.
      if (this.selected !== false) this.lastItemSearchState = 'search';
      return;
    }

    this.isItemSearchSplitVisible = false;
    this.current_tab = tab;
  },
  startItemSearchResize(event) {
    if (!this.isItemSearchSplitVisible) return;
    this.isItemSearchResizing = true;
    this.onItemSearchResize(event);
    window.addEventListener('mousemove', this.onItemSearchResize);
    window.addEventListener('mouseup', this.stopItemSearchResize);
  },
  onItemSearchResize(event) {
    if (!this.isItemSearchResizing || !this.$refs.leftSidebar) return;
    const rect = this.$refs.leftSidebar.getBoundingClientRect();
    const tabsHeight = this.$refs.leftSidebar.querySelector('.tabs')?.offsetHeight || 0;
    const dividerHeight =
      this.$refs.leftSidebar.querySelector('.item-search-resizer')?.offsetHeight || 0;
    const availableHeight = rect.height - tabsHeight - dividerHeight;
    if (availableHeight <= 0) return;
    const minRatio = 20;
    const maxRatio = 80;
    const nextRatio = ((event.clientY - rect.top - dividerHeight / 2) / availableHeight) * 100;
    this.itemSearchSplitRatio = Math.min(maxRatio, Math.max(minRatio, nextRatio));
  },
  stopItemSearchResize() {
    this.isItemSearchResizing = false;
    window.removeEventListener('mousemove', this.onItemSearchResize);
    window.removeEventListener('mouseup', this.stopItemSearchResize);
  },
  startSidebarResize(event) {
    this.isSidebarResizing = true;
    this.onSidebarResize(event);
    window.addEventListener('mousemove', this.onSidebarResize);
    window.addEventListener('mouseup', this.stopSidebarResize);
  },
  onSidebarResize(event) {
    if (!this.isSidebarResizing) return;
    const minWidth = 230;
    const maxWidth = Math.min(560, Math.max(280, window.innerWidth - 260));
    this.sidebarWidth = Math.round(
      Math.min(
        maxWidth,
        Math.max(
          minWidth,
          event.clientX - (this.$refs.leftSidebar?.getBoundingClientRect().left || 0),
        ),
      ),
    );
  },
  stopSidebarResize() {
    this.isSidebarResizing = false;
    window.removeEventListener('mousemove', this.onSidebarResize);
    window.removeEventListener('mouseup', this.stopSidebarResize);
  },
  showItemPanelAfterSelection() {
    if (this.lastItemSearchState === 'split') {
      this.isItemSearchSplitVisible = true;
      this.current_tab = 'item';
      return;
    }
    if (this.lastItemSearchState === 'item') {
      this.current_tab = 'item';
      return;
    }
    if (this.current_tab !== 'search') {
      this.current_tab = 'item';
    }
  },
  redrawCanvasAfterResize() {
    this.$nextTick(() => this.draw());
  },
};
