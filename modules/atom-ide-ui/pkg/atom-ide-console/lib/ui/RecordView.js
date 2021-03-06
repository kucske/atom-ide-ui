/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 * @format
 */

import type {Executor, Level, Record, SourceInfo} from '../types';
import type {RenderSegmentProps} from 'nuclide-commons-ui/Ansi';
import type {EvaluationResult} from 'nuclide-commons-ui/TextRenderer';

import classnames from 'classnames';
import {MeasuredComponent} from 'nuclide-commons-ui/MeasuredComponent';
import * as React from 'react';
import {LazyNestedValueComponent} from 'nuclide-commons-ui/LazyNestedValueComponent';
import SimpleValueComponent from 'nuclide-commons-ui/SimpleValueComponent';
import FullWidthProgressBar from 'nuclide-commons-ui/FullWidthProgressBar';
import shallowEqual from 'shallowequal';
import Ansi from 'nuclide-commons-ui/Ansi';
import {TextRenderer} from 'nuclide-commons-ui/TextRenderer';
import debounce from 'nuclide-commons/debounce';
import parseText from '../parseText';
import nullthrows from 'nullthrows';

type Props = {
  record: Record,
  showSourceLabel: boolean,
  getExecutor: (id: string) => ?Executor,
  getProvider: (id: string) => ?SourceInfo,
  onHeightChange: (record: Record, newHeight: number) => void,
  expansionStateId: Object,
};

const AnsiRenderSegment = ({key, style, content}: RenderSegmentProps) => (
  <span key={key} style={style} className="nuclide-console-default-text-colors">
    {parseText(content)}
  </span>
);

const ONE_DAY = 1000 * 60 * 60 * 24;
export default class RecordView extends React.Component<Props> {
  _wrapper: ?HTMLElement;
  _debouncedMeasureAndNotifyHeight: () => void;

  constructor(props: Props) {
    super(props);

    // The MeasuredComponent can call this many times in quick succession as the
    // child components render, so we debounce it since we only want to know about
    // the height change once everything has settled down
    (this: any)._debouncedMeasureAndNotifyHeight = debounce(
      this.measureAndNotifyHeight,
      10,
    );
  }

  componentDidMount() {
    // We initially assume a height for the record. After it is actually
    // rendered we need it to measure its actual height and report it
    this.measureAndNotifyHeight();
  }

  componentDidUpdate(prevProps: Props) {
    // Record is an immutable object, so any change that would affect a height
    // change should result in us getting a new object.
    if (this.props.record !== prevProps.record) {
      this.measureAndNotifyHeight();
    }
  }

  componentWillUnmount() {
    this._debouncedMeasureAndNotifyHeight.dispose();
  }

  _renderContent(): React.Element<any> {
    const {record} = this.props;
    if (record.kind === 'request') {
      // TODO: We really want to use a text editor to render this so that we can get syntax
      // highlighting, but they're just too expensive. Figure out a less-expensive way to get syntax
      // highlighting.
      return <pre>{record.text || ' '}</pre>;
    } else if (record.kind === 'response') {
      const executor = this.props.getExecutor(record.sourceId);
      return this._renderNestedValueComponent(executor);
    } else if (record.data != null) {
      const provider = this.props.getProvider(record.sourceId);
      return this._renderNestedValueComponent(provider);
    } else {
      // If there's not text, use a space to make sure the row doesn't collapse.
      const text = record.text || ' ';

      if (record.format === 'ansi') {
        return <Ansi renderSegment={AnsiRenderSegment}>{text}</Ansi>;
      }
      return <pre>{parseText(text)}</pre>;
    }
  }

  shouldComponentUpdate(nextProps: Props): boolean {
    return !shallowEqual(this.props, nextProps);
  }

  _renderNestedValueComponent(
    provider: ?SourceInfo | ?Executor,
  ): React.Element<any> {
    const {record, expansionStateId} = this.props;
    const getProperties = provider == null ? null : provider.getProperties;
    const type = record.data == null ? null : record.data.type;
    if (type === 'objects') {
      // Render multiple objects.
      const children = [];
      for (const [index, object] of nullthrows(
        record.data?.objects,
      ).entries()) {
        const evaluationResult: EvaluationResult = {
          description: object.description,
          type: object.type || '',
          // $FlowFixMe: that isn't an object ID,
          objectId: object.expression,
        };
        const simpleValueComponent = getComponent(object.type);

        // Each child must have it's own expansion state ID.
        const expansionStateKey = 'child' + index;
        if (!expansionStateId[expansionStateKey]) {
          expansionStateId[expansionStateKey] = {};
        }

        if (object.expression.reference === 0) {
          children.push(
            <SimpleValueComponent
              expression={null}
              evaluationResult={{
                type: object.type != null ? object.type : 'text',
                value: object.expression.getValue(),
              }}
            />,
          );
        } else {
          children.push(
            <LazyNestedValueComponent
              className="console-lazy-nested-value"
              evaluationResult={evaluationResult}
              fetchChildren={getProperties}
              simpleValueComponent={simpleValueComponent}
              shouldCacheChildren={true}
              expansionStateId={expansionStateId[expansionStateKey]}
            />,
          );
        }
      }
      return <span className="console-multiple-objects">{children}</span>;
    } else {
      // Render single object.
      const simpleValueComponent = getComponent(type);
      return (
        <LazyNestedValueComponent
          className="console-lazy-nested-value"
          evaluationResult={record.data}
          fetchChildren={getProperties}
          simpleValueComponent={simpleValueComponent}
          shouldCacheChildren={true}
          expansionStateId={expansionStateId}
        />
      );
    }
  }

  render(): React.Node {
    const {record} = this.props;
    const {level, kind, timestamp, sourceId, sourceName} = record;

    const classNames = classnames('console-record', `level-${level || 'log'}`, {
      request: kind === 'request',
      response: kind === 'response',
    });

    const iconName = getIconName(record);
    // flowlint-next-line sketchy-null-string:off
    const icon = iconName ? <span className={`icon icon-${iconName}`} /> : null;
    const sourceLabel = this.props.showSourceLabel ? (
      <span
        className={`console-record-source-label ${getHighlightClassName(
          level,
        )}`}>
        {sourceName ?? sourceId}
      </span>
    ) : null;
    let renderedTimestamp;
    if (timestamp != null) {
      const timestampLabel =
        Date.now() - timestamp > ONE_DAY
          ? timestamp.toLocaleString()
          : timestamp.toLocaleTimeString();
      renderedTimestamp = (
        <div className="console-record-timestamp">{timestampLabel}</div>
      );
    }
    return (
      <MeasuredComponent
        onMeasurementsChanged={this._debouncedMeasureAndNotifyHeight}>
        {/* $FlowFixMe(>=0.53.0) Flow suppress */}
        <div ref={this._handleRecordWrapper} className={classNames}>
          {icon}
          <div className="console-record-content-wrapper">
            {record.repeatCount > 1 && (
              <div className="console-record-duplicate-number">
                {record.repeatCount}
              </div>
            )}
            <div className="console-record-content">
              {this._renderContent()}
            </div>
          </div>
          {sourceLabel}
          {renderedTimestamp}
          {<FullWidthProgressBar progress={null} visible={record.incomplete} />}
        </div>
      </MeasuredComponent>
    );
  }

  measureAndNotifyHeight = () => {
    if (this._wrapper == null) {
      return;
    }
    const {offsetHeight} = this._wrapper;
    this.props.onHeightChange(this.props.record, offsetHeight);
  };

  _handleRecordWrapper = (wrapper: HTMLElement) => {
    this._wrapper = wrapper;
  };
}

function getComponent(type: ?string): React.ComponentType<any> {
  switch (type) {
    case 'text':
      return props => TextRenderer(props.evaluationResult);
    case 'boolean':
    case 'string':
    case 'number':
    case 'object':
    default:
      return SimpleValueComponent;
  }
}

function getHighlightClassName(level: Level): string {
  switch (level) {
    case 'info':
      return 'highlight-info';
    case 'success':
      return 'highlight-success';
    case 'warning':
      return 'highlight-warning';
    case 'error':
      return 'highlight-error';
    default:
      return 'highlight';
  }
}

function getIconName(record: Record): ?string {
  switch (record.kind) {
    case 'request':
      return 'chevron-right';
    case 'response':
      return 'arrow-small-left';
  }
  switch (record.level) {
    case 'info':
      return 'info';
    case 'success':
      return 'check';
    case 'warning':
      return 'alert';
    case 'error':
      return 'stop';
  }
}
