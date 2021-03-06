import React, {PropTypes, PureComponent} from 'react';
import autobind from 'autobind-decorator';
import clone from 'clone';
import * as templating from '../../../templating';
import * as templateUtils from '../../../templating/utils';
import * as db from '../../../common/database';
import * as models from '../../../models';
import HelpTooltip from '../help-tooltip';
import {fnOrString} from '../../../common/misc';
import {trackEvent} from '../../../analytics/index';

@autobind
class TagEditor extends PureComponent {
  constructor (props) {
    super(props);

    const activeTagData = templateUtils.tokenizeTag(props.defaultValue);

    const tagDefinitions = templating.getTagDefinitions();
    const activeTagDefinition = tagDefinitions.find(d => d.name === activeTagData.name);

    // Edit tags raw that we don't know about
    if (!activeTagDefinition) {
      activeTagData.rawValue = props.defaultValue;
    }

    this.state = {
      activeTagData,
      activeTagDefinition,
      loadingDocs: true,
      allDocs: {},
      preview: '',
      error: ''
    };
  }

  async componentWillMount () {
    await this._refreshModels(this.props.workspace);
    await this._update(this.state.activeTagDefinition, this.state.activeTagData, true);
  }

  componentWillReceiveProps (nextProps) {
    const {workspace} = nextProps;

    if (this.props.workspace._id !== workspace._id) {
      this._refreshModels(workspace);
    }
  }

  async _refreshModels (workspace) {
    const allDocs = {};
    for (const type of models.types()) {
      allDocs[type] = [];
    }

    for (const doc of await db.withDescendants(workspace)) {
      allDocs[doc.type].push(doc);
    }

    this.setState({allDocs, loadingDocs: false});
  }

  _updateArg (argValue, argIndex) {
    const {activeTagData, activeTagDefinition} = this.state;

    const tagData = clone(activeTagData);
    tagData.args[argIndex].value = argValue;

    this._update(activeTagDefinition, tagData, false);
  }

  _handleChange (e) {
    const parent = e.target.parentNode;
    const argIndex = parent.getAttribute('data-arg-index');

    if (e.target.type === 'number') {
      return this._updateArg(parseFloat(e.target.value), argIndex);
    } else {
      return this._updateArg(e.target.value, argIndex);
    }
  }

  _handleChangeCustomArg (e) {
    const {activeTagData, activeTagDefinition} = this.state;

    const tagData = clone(activeTagData);
    tagData.rawValue = e.target.value;

    this._update(activeTagDefinition, tagData, false);
  }

  _handleChangeTag (e) {
    const name = e.target.value;
    const tagDefinition = templating.getTagDefinitions().find(d => d.name === name);
    this._update(tagDefinition, false);
    trackEvent('Tag Editor', 'Change Tag', name);
  }

  _setSelectRef (n) {
    this._select = n;

    // Let it render, then focus the input
    setTimeout(() => {
      this._select && this._select.focus();
    }, 100);
  }

  _getDefaultTagData (tagDefinition) {
    const defaultFill = templateUtils.getDefaultFill(
      tagDefinition.name,
      tagDefinition.args
    );

    return templateUtils.tokenizeTag(defaultFill);
  }

  async _update (tagDefinition, tagData, noCallback = false) {
    const {handleRender} = this.props;

    let preview = '';
    let error = '';

    let activeTagData = tagData;
    if (!activeTagData && tagDefinition) {
      activeTagData = this._getDefaultTagData(tagDefinition);
    } else if (!activeTagData && !tagDefinition) {
      activeTagData = {
        name: 'custom',
        rawValue: templateUtils.unTokenizeTag(this.state.activeTagData)
      };
    }

    let template;
    try {
      template = typeof activeTagData.rawValue === 'string'
        ? activeTagData.rawValue
        : templateUtils.unTokenizeTag(activeTagData);
      preview = await handleRender(template, true);
    } catch (err) {
      error = err.message;
    }

    const isMounted = !!this._select;
    if (isMounted) {
      this.setState({
        activeTagData,
        preview,
        error,
        activeTagDefinition: tagDefinition
      });
    }

    // Call the callback if we need to
    if (!noCallback) {
      this.props.onChange(template);
    }
  }

  renderArgString (value, placeholder) {
    return (
      <input
        type="text"
        defaultValue={value || ''}
        placeholder={placeholder}
        onChange={this._handleChange}
      />
    );
  }

  renderArgNumber (value, placeholder) {
    return (
      <input
        type="number"
        defaultValue={value || 0}
        placeholder={placeholder}
        onChange={this._handleChange}
      />
    );
  }

  renderArgEnum (value, options) {
    return (
      <select value={value} onChange={this._handleChange}>
        {options.map(option => {
          let label;
          if (option.description) {
            label = `${option.displayName} – ${option.description}`;
          } else {
            label = option.displayName;
          }

          return (
            <option key={option.value} value={option.value}>
              {label}
            </option>
          );
        })}
      </select>
    );
  }

  renderArgModel (value, modelType) {
    const {allDocs, loadingDocs} = this.state;
    const docs = allDocs[modelType] || [];
    const id = value || 'n/a';

    return (
      <select value={id} disabled={loadingDocs} onChange={this._handleChange}>
        <option value="n/a">-- Select Item --</option>
        {docs.map(doc => {
          let namePrefix = null;

          // Show paren't folder with name if it's a request
          if (doc.type === models.request.type) {
            const requests = allDocs[models.request.type] || [];
            const request = requests.find(r => r._id === doc._id);
            const parentId = request ? request.parentId : 'n/a';
            const requestGroups = allDocs[models.requestGroup.type] || [];
            const requestGroup = requestGroups.find(rg => rg._id === parentId);
            namePrefix = requestGroup ? `[${requestGroup.name}] ` : null;
          }

          return (
            <option key={doc._id} value={doc._id}>{namePrefix}{doc.name}</option>
          );
        })}
      </select>
    );
  }

  renderArg (argDefinition, args, argIndex) {
    // Decide whether or not to show it
    if (argDefinition.hide && argDefinition.hide(args)) {
      return null;
    }

    let argData;
    if (argIndex < args.length) {
      argData = args[argIndex];
    } else {
      const defaultTagData = this._getDefaultTagData(this.state.activeTagDefinition);
      argData = defaultTagData.args[argIndex];
    }

    const value = argData.value;

    let argInput;
    if (argDefinition.type === 'string') {
      const {placeholder} = argDefinition;
      argInput = this.renderArgString(value, placeholder);
    } else if (argDefinition.type === 'enum') {
      const {options} = argDefinition;
      argInput = this.renderArgEnum(value, options);
    } else if (argDefinition.type === 'model') {
      const {model} = argDefinition;
      argInput = this.renderArgModel(value, model);
    } else if (argDefinition.type === 'number') {
      const {placeholder} = argDefinition;
      argInput = this.renderArgNumber(value, placeholder);
    } else {
      return null;
    }

    const {displayName} = argDefinition;
    return (
      <div key={argIndex} className="form-control form-control--outlined">
        <label>
          {fnOrString(displayName, args)}
          {argDefinition.help && (
            <HelpTooltip className="space-left">{argDefinition.help}</HelpTooltip>
          )}
          <div data-arg-index={argIndex}>
            {argInput}
          </div>
        </label>
      </div>
    );
  }

  render () {
    const {error, preview, activeTagDefinition, activeTagData} = this.state;

    return (
      <div>
        <div className="form-control form-control--outlined">
          <label>Function to Perform
            <select ref={this._setSelectRef}
                    onChange={this._handleChangeTag}
                    value={activeTagDefinition ? activeTagDefinition.name : ''}>
              {templating.getTagDefinitions().map((tagDefinition, i) => (
                <option key={`${i}::${tagDefinition.name}`} value={tagDefinition.name}>
                  {tagDefinition.displayName} – {tagDefinition.description}
                </option>
              ))}
              <option value="custom">-- Custom --</option>
            </select>
          </label>
        </div>
        {activeTagDefinition && activeTagDefinition.args.map((argDefinition, index) => (
          this.renderArg(argDefinition, activeTagData.args, index)
        ))}
        {!activeTagDefinition && (
          <div className="form-control form-control--outlined">
            <label>Custom
              <input type="text"
                     defaultValue={activeTagData.rawValue}
                     onChange={this._handleChangeCustomArg}/>
            </label>
          </div>
        )}
        <div className="form-control form-control--outlined">
          <label>Live Preview
            {error
              ? <code className="block danger selectable">{error || <span>&nbsp;</span>}</code>
              : <code className="block selectable">{preview || <span>&nbsp;</span>}</code>
            }
          </label>
        </div>
      </div>
    );
  }
}

TagEditor.propTypes = {
  handleRender: PropTypes.func.isRequired,
  defaultValue: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  workspace: PropTypes.object.isRequired
};

export default TagEditor;
