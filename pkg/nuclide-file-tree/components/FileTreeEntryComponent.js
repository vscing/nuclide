/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {FileTreeNode} from '../lib/FileTreeNode';
import type Immutable from 'immutable';

import FileTreeActions from '../lib/FileTreeActions';
import FileTreeHelpers from '../lib/FileTreeHelpers';
import * as Selectors from '../lib/FileTreeSelectors';
import * as React from 'react';
import ReactDOM from 'react-dom';
import classnames from 'classnames';
import {nextAnimationFrame} from 'nuclide-commons/observable';
import UniversalDisposable from 'nuclide-commons/UniversalDisposable';
import nullthrows from 'nullthrows';
import {filterName} from '../lib/FileTreeFilterHelper';
import {Checkbox} from 'nuclide-commons-ui/Checkbox';
import {StatusCodeNumber} from '../../nuclide-hg-rpc/lib/hg-constants';
import FileTreeStore from '../lib/FileTreeStore';
import FileTreeHgHelpers from '../lib/FileTreeHgHelpers';
import addTooltip from 'nuclide-commons-ui/addTooltip';
import PathWithFileIcon from '../../nuclide-ui/PathWithFileIcon';
import invariant from 'assert';
import {Observable} from 'rxjs';

type Props = {|
  node: FileTreeNode,
  selectedNodes: Immutable.Set<FileTreeNode>,
  focusedNodes: Immutable.Set<FileTreeNode>,
  isPreview?: boolean,
  store: FileTreeStore,
  actions: FileTreeActions,
|};

type State = {|
  isLoading: boolean,
|};

const SUBSEQUENT_FETCH_SPINNER_DELAY = 500;
const INITIAL_FETCH_SPINNER_DELAY = 25;
const INDENT_LEVEL = 17;
const CHAR_EM_SCALE_FACTOR = 0.9;

export class FileTreeEntryComponent extends React.Component<Props, State> {
  // Keep track of the # of dragenter/dragleave events in order to properly decide
  // when an entry is truly hovered/unhovered, since these fire many times over
  // the duration of one user interaction.
  _arrowContainer: ?HTMLElement;
  dragEventCount: number;
  _loadingTimeout: ?TimeoutID;
  _disposables: ?UniversalDisposable;
  _pathContainer: ?HTMLElement;

  constructor(props: Props) {
    super(props);
    this.dragEventCount = 0;

    this.state = {
      isLoading: props.node.isLoading,
    };
  }

  shouldComponentUpdate(nextProps: Props, nextState: State): boolean {
    return (
      nextProps.node !== this.props.node ||
      nextProps.node.isLoading !== this.props.node.isLoading ||
      nextState.isLoading !== this.state.isLoading ||
      nextProps.selectedNodes !== this.props.selectedNodes ||
      nextProps.focusedNodes !== this.props.focusedNodes
    );
  }

  UNSAFE_componentWillReceiveProps(nextProps: Props): void {
    if (nextProps.node.isLoading !== this.props.node.isLoading) {
      if (this._loadingTimeout != null) {
        clearTimeout(this._loadingTimeout);
        this._loadingTimeout = null;
      }

      if (nextProps.node.isLoading) {
        const spinnerDelay = nextProps.node.wasFetched
          ? SUBSEQUENT_FETCH_SPINNER_DELAY
          : INITIAL_FETCH_SPINNER_DELAY;

        this._loadingTimeout = setTimeout(() => {
          this._loadingTimeout = null;
          this.setState({
            isLoading: Boolean(this.props.node.isLoading),
          });
        }, spinnerDelay);
      } else {
        this.setState({
          isLoading: false,
        });
      }
    }
  }

  componentDidMount(): void {
    const el = ReactDOM.findDOMNode(this);
    this._disposables = new UniversalDisposable(
      // Because this element can be inside of an Atom panel (which adds its own drag and drop
      // handlers) we need to sidestep React's event delegation.
      Observable.fromEvent(el, 'dragenter').subscribe(this._onDragEnter),
      Observable.fromEvent(el, 'dragleave').subscribe(this._onDragLeave),
      Observable.fromEvent(el, 'dragstart').subscribe(this._onDragStart),
      Observable.fromEvent(el, 'dragover').subscribe(this._onDragOver),
      Observable.fromEvent(el, 'dragend').subscribe(this._onDragEnd),
      Observable.fromEvent(el, 'drop').subscribe(this._onDrop),
    );
  }

  componentWillUnmount(): void {
    invariant(this._disposables != null);
    this._disposables.dispose();
    if (this._loadingTimeout != null) {
      clearTimeout(this._loadingTimeout);
    }
  }

  render(): React.Node {
    const node = this.props.node;
    const isSelected = this.props.selectedNodes.has(node);

    const outerClassName = classnames('entry', {
      'file list-item': !node.isContainer,
      'directory list-nested-item': node.isContainer,
      'current-working-directory': node.isCwd,
      collapsed: !node.isLoading && !node.isExpanded,
      expanded: !node.isLoading && node.isExpanded,
      'project-root': node.isRoot,
      selected: isSelected || node.isDragHovered,
      'nuclide-file-tree-softened': node.shouldBeSoftened,
      'nuclide-file-tree-root-being-reordered': node.isBeingReordered,
    });
    const listItemClassName = classnames({
      'header list-item': node.isContainer,
      loading: this.state.isLoading,
    });

    let statusClass;
    if (!node.conf.isEditingWorkingSet) {
      const vcsStatusCode = node.vcsStatusCode;
      if (vcsStatusCode === StatusCodeNumber.MODIFIED) {
        statusClass = 'status-modified';
      } else if (vcsStatusCode === StatusCodeNumber.ADDED) {
        statusClass = 'status-added';
      } else if (node.isIgnored) {
        statusClass = 'status-ignored';
      } else {
        statusClass = '';
      }
    } else {
      switch (node.checkedStatus) {
        case 'checked':
          statusClass = 'status-added';
          break;
        case 'partial':
          statusClass = 'status-modified';
          break;
        default:
          statusClass = '';
          break;
      }
    }

    let generatedClass;
    if (node.generatedStatus === 'generated') {
      generatedClass = 'generated-fully';
    } else if (node.generatedStatus === 'partial') {
      generatedClass = 'generated-partly';
    } else {
      generatedClass = '';
    }

    let tooltip;
    if (node.isContainer) {
      if (node.isCwd) {
        tooltip = addTooltip({title: 'Current Working Root'});
      }
    }

    let min_width = 'max-content';
    if (this.props.store != null) {
      const size = Selectors.getMaxComponentWidth(this.props.store);
      if (size != null && typeof size === 'number' && size > 0) {
        min_width = size * CHAR_EM_SCALE_FACTOR + 'em';
      }
    }

    return (
      <li
        className={classnames(outerClassName, statusClass, generatedClass, {
          // `atom/find-and-replace` looks for this class to determine if a
          // data-path is a directory or not:
          directory: node.isContainer,
        })}
        style={{
          paddingLeft: node.isContainer
            ? this.props.node.getDepth() * INDENT_LEVEL
            : // Folders typically render a disclosure triangle, making them appear
              // at one depth level more than they actually are. Compensate by
              // adding the appearance of an extra level of depth for files.
              this.props.node.getDepth() * INDENT_LEVEL + INDENT_LEVEL,
          minWidth: min_width,
          marginLeft: 0,
        }}
        draggable={true}
        onMouseDown={this._onMouseDown}
        onClick={this._onClick}
        onDoubleClick={this._onDoubleClick}
        data-name={node.name}
        data-path={node.uri}>
        <div
          className={listItemClassName}
          // eslint-disable-next-line nuclide-internal/jsx-simple-callback-refs
          ref={el => {
            this._arrowContainer = el;
            this.props.actions.updateMaxComponentWidth(
              this.props.node.name.length,
            );
          }}>
          <PathWithFileIcon
            className={classnames('name', 'nuclide-file-tree-path', {
              'icon-nuclicon-file-directory': node.isContainer && !node.isCwd,
              'icon-nuclicon-file-directory-starred':
                node.isContainer && node.isCwd,
            })}
            isFolder={node.isContainer}
            path={node.uri}
            // eslint-disable-next-line nuclide-internal/jsx-simple-callback-refs
            ref={elem => {
              // $FlowFixMe(>=0.53.0) Flow suppress
              this._pathContainer = elem;
              tooltip && tooltip(elem);
            }}
            data-name={node.name}
            data-path={node.uri}>
            {this._renderCheckbox()}
            {filterName(node.name, node.highlightedText, isSelected)}
          </PathWithFileIcon>
          {this._renderConnectionTitle()}
        </div>
      </li>
    );
  }

  _renderCheckbox(): ?React.Element<any> {
    if (!this.props.node.conf.isEditingWorkingSet) {
      return;
    }

    return (
      <Checkbox
        checked={this.props.node.checkedStatus === 'checked'}
        indeterminate={this.props.node.checkedStatus === 'partial'}
        onChange={this._checkboxOnChange}
        onClick={this._checkboxOnClick}
        onMouseDown={this._checkboxOnMouseDown}
      />
    );
  }

  _renderConnectionTitle(): ?React.Element<any> {
    if (!this.props.node.isRoot) {
      return null;
    }
    const title = this.props.node.connectionTitle;
    if (title === '' || title === '(default)') {
      return null;
    }

    return (
      <span className="nuclide-file-tree-connection-title highlight">
        {title}
      </span>
    );
  }

  _isToggleNodeExpand(event: SyntheticMouseEvent<>) {
    if (!this._pathContainer) {
      return;
    }

    const node = this.props.node;
    const shouldToggleExpand =
      node.isContainer &&
      // $FlowFixMe
      nullthrows(this._arrowContainer).contains(event.target) &&
      event.clientX <
        // $FlowFixMe
        ReactDOM.findDOMNode(this._pathContainer).getBoundingClientRect().left;
    if (shouldToggleExpand) {
      this.props.actions.clearTrackedNode();
    }

    return shouldToggleExpand;
  }

  _onMouseDown = (event: SyntheticMouseEvent<>) => {
    event.stopPropagation();
    if (this._isToggleNodeExpand(event)) {
      return;
    }

    const node = this.props.node;
    const isSelected = this.props.selectedNodes.has(node);

    const selectionMode = FileTreeHelpers.getSelectionMode(event);
    if (selectionMode === 'multi-select' && !isSelected) {
      this.props.actions.addSelectedNode(node.rootUri, node.uri);
    } else if (selectionMode === 'range-select') {
      this.props.actions.rangeSelectToNode(node.rootUri, node.uri);
    } else if (selectionMode === 'single-select' && !isSelected) {
      this.props.actions.setSelectedNode(node.rootUri, node.uri);
    }
  };

  _onClick = (event: SyntheticMouseEvent<>) => {
    event.stopPropagation();
    const node = this.props.node;
    const isSelected = this.props.selectedNodes.has(node);
    const isFocused = this.props.focusedNodes.has(node);

    const deep = event.altKey;
    if (this._isToggleNodeExpand(event)) {
      this._toggleNodeExpanded(deep);
      return;
    }

    const selectionMode = FileTreeHelpers.getSelectionMode(event);

    if (
      selectionMode === 'range-select' ||
      selectionMode === 'invalid-select'
    ) {
      return;
    }

    if (selectionMode === 'multi-select') {
      if (isFocused) {
        this.props.actions.unselectNode(node.rootUri, node.uri);
        // If this node was just unselected, immediately return and skip
        // the statement below that sets this node to focused.
        return;
      }
    } else {
      if (node.isContainer) {
        if (isFocused || node.conf.usePreviewTabs) {
          this._toggleNodeExpanded(deep);
        }
      } else {
        if (node.conf.usePreviewTabs) {
          this.props.actions.confirmNode(
            node.rootUri,
            node.uri,
            true, // pending
          );
        }
      }
      // Set selected node to clear any other selected nodes (i.e. in the case of
      // previously having multiple selections).
      this.props.actions.setSelectedNode(node.rootUri, node.uri);
    }

    if (isSelected) {
      this.props.actions.setFocusedNode(node.rootUri, node.uri);
    }
  };

  _onDoubleClick = (event: SyntheticMouseEvent<>) => {
    event.stopPropagation();

    if (this.props.node.isContainer) {
      return;
    }

    this.props.actions.confirmNode(
      this.props.node.rootUri,
      this.props.node.uri,
    );
  };

  _onDragEnter = (event: DragEvent) => {
    event.stopPropagation();

    const nodes = Selectors.getSelectedNodes(this.props.store);
    if (
      !this.props.isPreview &&
      nodes.size === 1 &&
      nullthrows(nodes.first()).isRoot
    ) {
      this.props.actions.reorderDragInto(this.props.node.rootUri);
      return;
    }
    const movableNodes = nodes.filter(node =>
      FileTreeHgHelpers.isValidRename(node, this.props.node.uri),
    );

    // Ignores hover over invalid targets.
    if (!this.props.node.isContainer || movableNodes.size === 0) {
      return;
    }
    if (this.dragEventCount <= 0) {
      this.dragEventCount = 0;
      this.props.actions.setDragHoveredNode(
        this.props.node.rootUri,
        this.props.node.uri,
      );
    }
    this.dragEventCount++;
  };

  _onDragLeave = (event: DragEvent) => {
    event.stopPropagation();
    // Avoid calling an unhoverNode action if dragEventCount is already 0.
    if (this.dragEventCount === 0) {
      return;
    }
    this.dragEventCount--;
    if (this.dragEventCount <= 0) {
      this.dragEventCount = 0;
      this.props.actions.unhoverNode(
        this.props.node.rootUri,
        this.props.node.uri,
      );
    }
  };

  _onDragStart = (event: DragEvent) => {
    event.stopPropagation();

    if (this._pathContainer == null) {
      return;
    }

    // $FlowFixMe
    const target: HTMLElement = ReactDOM.findDOMNode(this._pathContainer);
    if (target == null) {
      return;
    }

    const fileIcon = target.cloneNode(false);
    fileIcon.style.cssText =
      'position: absolute; top: 0; left: 0; color: #fff; opacity: .8;';
    invariant(document.body != null);
    document.body.appendChild(fileIcon);

    const {dataTransfer} = event;
    if (dataTransfer != null) {
      dataTransfer.effectAllowed = 'move';
      dataTransfer.setDragImage(fileIcon, -8, -4);
      dataTransfer.setData('initialPath', this.props.node.uri);
    }
    nextAnimationFrame.subscribe(() => {
      invariant(document.body != null);
      document.body.removeChild(fileIcon);
    });

    if (this.props.node.isRoot) {
      this.props.actions.startReorderDrag(this.props.node.uri);
    }
  };

  _onDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  _onDragEnd = (event: DragEvent) => {
    if (this.props.node.isRoot) {
      this.props.actions.endReorderDrag();
    }
  };

  _onDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const dragNode = Selectors.getSingleSelectedNode(this.props.store);
    if (dragNode != null && dragNode.isRoot) {
      this.props.actions.reorderRoots();
    } else {
      // Reset the dragEventCount for the currently dragged node upon dropping.
      this.dragEventCount = 0;
      this.props.actions.moveToNode(
        this.props.node.rootUri,
        this.props.node.uri,
      );
    }
  };

  _toggleNodeExpanded(deep: boolean): void {
    if (this.props.node.isExpanded) {
      if (deep) {
        this.props.actions.collapseNodeDeep(
          this.props.node.rootUri,
          this.props.node.uri,
        );
      } else {
        this.props.actions.collapseNode(
          this.props.node.rootUri,
          this.props.node.uri,
        );
      }
    } else {
      if (deep) {
        this.props.actions.expandNodeDeep(
          this.props.node.rootUri,
          this.props.node.uri,
        );
      } else {
        this.props.actions.expandNode(
          this.props.node.rootUri,
          this.props.node.uri,
        );
      }
    }
  }

  _checkboxOnChange = (isChecked: boolean): void => {
    if (isChecked) {
      this.props.actions.checkNode(
        this.props.node.rootUri,
        this.props.node.uri,
      );
    } else {
      this.props.actions.uncheckNode(
        this.props.node.rootUri,
        this.props.node.uri,
      );
    }
  };

  _checkboxOnClick = (event: SyntheticEvent<>): void => {
    event.stopPropagation();
  };

  _checkboxOnMouseDown = (event: SyntheticMouseEvent<>): void => {
    // Chrome messes with scrolling if a focused input is being scrolled out of view
    // so we'll just prevent the checkbox from receiving the focus
    event.preventDefault();
  };
}
