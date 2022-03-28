'use strict';

var attributeValidationError = require('../../external/attribute-validation-error');
var constants = require('../../shared/constants');
var classList = require('@braintree/class-list');
var supportsPassiveEventListener = require('../../../lib/supports-passive-event-listener');
var browserDetection = require('../../shared/browser-detection');
var createRestrictedInput = require('../../../lib/create-restricted-input');
var events = constants.events;
var allowedFields = constants.allowedFields;
var ENTER_KEY_CODE = 13;
var DEFAULT_MASK_CHARACTER = '•';

// NEXT_MAJOR_VERSION Use inputMode="numeric" with type="text" instead of type="tel"
// for inputs that require the 0-9 Keyboard.
// https://github.com/braintree/braintree-web/pull/542
// iOS ^v12.2 technically supports inputMode, but it uses the alphanumeric
// keyboard instead of the numeric keyboard. Because of this (and difficulty
// testing on old Android Chrome versions) we'll put this off until the
// next major version.
function constructAttributes(options) {
  var field = options.field;
  var name = options.name;
  var attributes = {
    autocomplete: constants.autocompleteMappings[name],
    type: options.type,
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    'class': field,
    'data-braintree-name': field,
    name: name,
    id: name
  };

  if (!attributes.type) {
    if (browserDetection.isIos()) {
      attributes.type = 'text';
      attributes.pattern = '\\d*';
    } else {
      attributes.type = 'tel';
    }
  }

  if (!options.shouldAutofill) {
    attributes.autocomplete = 'off';
    // Chrome ignores the autocomplete=off setting
    // so we also need to make the name field generic.
    // Screenreaders should ignore this and use the
    // label instead of the name attribute
    attributes.name = 'field';
  }

  return attributes;
}

function BaseInput(options) {
  var shouldFormat, configuration;

  this.model = options.model;
  this.type = options.type;

  configuration = this.getConfiguration();

  this._prefill = configuration.prefill && String(configuration.prefill);

  this.hiddenMaskedValue = '';
  this.shouldMask = Boolean(configuration.maskInput);
  this.maskCharacter = (configuration.maskInput && configuration.maskInput.character) || DEFAULT_MASK_CHARACTER;

  this.element = this.constructElement();

  shouldFormat = configuration.formatInput !== false && this.element instanceof HTMLInputElement;
  this.formatter = createRestrictedInput(this._createRestrictedInputOptions({
    shouldFormat: shouldFormat
  }));

  this.addDOMEventListeners();
  this.addModelEventListeners();
  this.addBusEventListeners();

  this._applyPrefill();

  this.render();
}

BaseInput.prototype.getConfiguration = function () {
  return this.model.configuration.fields[this.type];
};

BaseInput.prototype.updateModel = function (key, value) {
  this.model.set(this.type + '.' + key, value);
};

BaseInput.prototype.modelOnChange = function (property, callback) {
  var eventPrefix = 'change:' + this.type;
  var self = this;

  this.model.on(eventPrefix + '.' + property, function () {
    callback.apply(self, arguments);
  });
};

BaseInput.prototype.constructElement = function () {
  var type = this.type;
  var element = document.createElement('input');

  var placeholder = this.getConfiguration().placeholder;
  var name = allowedFields[type] ? allowedFields[type].name : null;

  var attributes = constructAttributes({
    field: type,
    type: this.getConfiguration().type,
    name: name,
    shouldAutofill: this.model.configuration.preventAutofill !== true
  });

  if (this.maxLength) {
    attributes.maxlength = this.maxLength;
  }

  if (placeholder) {
    attributes.placeholder = placeholder;
  }

  Object.keys(attributes).forEach(function (attr) {
    element.setAttribute(attr, attributes[attr]);
  });

  return element;
};

BaseInput.prototype.getUnformattedValue = function () {
  return this.formatter.getUnformattedValue();
};

BaseInput.prototype.addDOMEventListeners = function () {
  this._addDOMFocusListeners();
  this._addDOMInputListeners();
  this._addDOMKeypressListeners();
  this._addPasteEventListeners();
};

BaseInput.prototype._applyPrefill = function () {
  if (!this._prefill) {
    return;
  }

  this.element.value = this._prefill;
  this.model.set(this.type + '.value', this._prefill);
};

BaseInput.prototype.maskValue = function (value) {
  value = value || this.element.value;

  this.hiddenMaskedValue = value;
  this.element.value = value.replace(/[^\s\/\-]/g, this.maskCharacter);
};

BaseInput.prototype.unmaskValue = function () {
  this.element.value = this.hiddenMaskedValue;
};

BaseInput.prototype._addDOMKeypressListeners = function () {
  this.element.addEventListener('keypress', function (event) {
    if (event.keyCode === ENTER_KEY_CODE) {
      this.model.emitEvent(this.type, 'inputSubmitRequest');
    }
  }.bind(this), false);
};

BaseInput.prototype._addPasteEventListeners = function () {
  this.element.addEventListener('paste', function () {
    this.render();
  }.bind(this), false);
};

BaseInput.prototype._addDOMInputListeners = function () {
  this.element.addEventListener(this._getDOMChangeEvent(), function () {
    this.hiddenMaskedValue = this.element.value;
    this.updateModel('value', this.getUnformattedValue());
  }.bind(this), false);
};

BaseInput.prototype._getDOMChangeEvent = function () {
  return browserDetection.isIe9() ? 'keyup' : 'input';
};

BaseInput.prototype._addDOMFocusListeners = function () {
  var element = this.element;
  var self = this;

  if ('onfocusin' in document) {
    document.documentElement.addEventListener('focusin', function (event) {
      if (event.fromElement === element) { return; }
      if (event.relatedTarget) { return; }

      self.focus();
    }, false);
  } else {
    document.addEventListener('focus', function () {
      self.focus();
    }, false);
  }

  element.addEventListener('focus', function () {
    this.updateModel('isFocused', true);
  }.bind(this), false);

  element.addEventListener('blur', function () {
    this.updateModel('isFocused', false);
  }.bind(this), false);

  window.addEventListener('focus', function () {
    if (this.shouldMask) {
      this.unmaskValue();
    }
    this.updateModel('isFocused', true);
  }.bind(this), false);

  window.addEventListener('blur', function () {
    if (this.shouldMask) {
      this.maskValue();
    }
    this.updateModel('isFocused', false);
  }.bind(this), false);

  if (browserDetection.isIos()) {
    // select inputs don't have a select function
    if (typeof element.select === 'function' && !browserDetection.isIosWebview()) {
      element.addEventListener('touchstart', function () {
        element.select();
      }, supportsPassiveEventListener ? {passive: true} : false);
    }

    // fixes the issue on iOS where the input doesn't focus properly
    // on touch events after the initial one
    window.addEventListener('touchend', function () {
      window.focus();
    });
  }
};

BaseInput.prototype.focus = function () {
  this.element.focus();
  this.updateModel('isFocused', true);
};

BaseInput.prototype.addModelEventListeners = function () {
  this.modelOnChange('isValid', this.render);
  this.modelOnChange('isPotentiallyValid', this.render);

  this.model.on('autofill:' + this.type, function (value) {
    this.element.value = '';
    this.updateModel('value', '');
    this.element.value = value;
    this.updateModel('value', value);

    if (this.shouldMask) {
      this.maskValue(value);
    }
    this._resetPlaceholder();

    this.render();
  }.bind(this));
};

BaseInput.prototype.setPlaceholder = function (type, placeholder) {
  this.type.setAttribute(type, 'placeholder', placeholder);
};

BaseInput.prototype.setAttribute = function (type, attribute, value) {
  if (type === this.type && !attributeValidationError(attribute, value)) {
    this.element.setAttribute(attribute, value);
  }
};

BaseInput.prototype.removeAttribute = function (type, attribute) {
  if (type === this.type && !attributeValidationError(attribute)) {
    this.element.removeAttribute(attribute);
  }
};

BaseInput.prototype.addBusEventListeners = function () {
  window.bus.on(events.TRIGGER_INPUT_FOCUS, function (data) {
    if (data.field === this.type) { this.focus(); }
  }.bind(this));

  window.bus.on(events.SET_ATTRIBUTE, function (data) {
    this.setAttribute(data.field, data.attribute, data.value);
  }.bind(this));
  window.bus.on(events.REMOVE_ATTRIBUTE, function (data) {
    this.removeAttribute(data.field, data.attribute);
  }.bind(this));

  window.bus.on(events.ADD_CLASS, function (data) {
    if (data.field === this.type) { classList.add(this.element, data.classname); }
  }.bind(this));

  window.bus.on(events.REMOVE_CLASS, function (data) {
    if (data.field === this.type) { classList.remove(this.element, data.classname); }
  }.bind(this));

  window.bus.on(events.CLEAR_FIELD, function (data) {
    if (data.field === this.type) {
      this.element.value = '';
      this.hiddenMaskedValue = '';
      this.updateModel('value', '');
    }
  }.bind(this));
};

BaseInput.prototype.render = function () {
  var modelData = this.model.get(this.type);
  var isValid = modelData.isValid;
  var isPotentiallyValid = modelData.isPotentiallyValid;

  classList.toggle(this.element, 'valid', isValid);
  classList.toggle(this.element, 'invalid', !isPotentiallyValid);

  if (this.maxLength) {
    this.element.setAttribute('maxlength', this.maxLength);
  }
};

BaseInput.prototype._createRestrictedInputOptions = function (options) {
  return {
    shouldFormat: options.shouldFormat,
    element: this.element,
    pattern: ' '
  };
};

BaseInput.prototype._resetPlaceholder = function () {
  // After autofill, Safari leaves the placeholder visible in the iframe, we
  // compensate for this by removing and re-setting the placeholder
  var placeholder = this.element.getAttribute('placeholder');

  if (placeholder) {
    this.element.setAttribute('placeholder', '');
    this.element.setAttribute('placeholder', placeholder);
  }
};

module.exports = {
  BaseInput: BaseInput
};
