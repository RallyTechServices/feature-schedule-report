Ext.define('Rally.technicalservices.FieldValueDialog', {
    extend: 'Rally.ui.dialog.Dialog',
    alias: 'widget.tsfieldvaluedialog',
    height: 300,
    width: 300,
    layout: 'fit',
    closable: true,
    draggable: true,
    
    config: {
        /**
         * @cfg {String}
         * Title to give to the dialog
         */
        title: 'Choose a Value',
        /**
         * @cfg {Array} (required)
         * Artifact with field
         */
        artifactType: 'PortfolioItem',
        /**
         * @cfg {Array} (required)
         * Field on Artifact to pick
         */
        artifactField: 'State',
        
        /**
         * @cfg {Boolean}
         * Allow multiple selection or not
         */
        multiple: true,

        /**
         * @cfg {Ext.grid.Column}
         * List of columns that will be used in the chooser
         */
        columns: [
            'Name'
        ],

        /**
         * @cfg {String}
         * Text to be displayed on the button when selection is complete
         */
        selectionButtonText: 'Done',

        /**
         * @cfg {Object}
         * The grid configuration to be used when creative the grid of items in the dialog
         */
        gridConfig: {},

        /**
         * @cfg {Array}
         * The values to remove from the selection grid
         */
        removeValues: undefined,
        
        /**
         * 
         * @cfg {Boolean}
         * If true, won't disable the Done button just because nothing is selected
         */
        allowEmptyResponse: false
    },

    selectionCache: [],

    constructor: function(config) {
        this.mergeConfig(config);
        this.callParent([this.config]);
    },

    initComponent: function() {
        this.callParent(arguments);

        this.addEvents(
            /**
             * @event valuechosen
             * Fires when user clicks done after choosing a value
             * @param {Rally.technicalservices.FieldValueDialog} source the dialog
             * @param {String} selection selected value or an array of selected values if multiple is true
             */
            'valuechosen'
        );

        this.addCls(['chooserDialog', 'chooser-dialog']);
    },

    beforeRender: function() {
        this.callParent(arguments);

        this.addDocked({
            xtype: 'toolbar',
            dock: 'bottom',
            padding: '0 0 10 0',
            layout: {
                type: 'hbox',
                pack: 'center'
            },
            ui: 'footer',
            items: [
                {
                    xtype: 'rallybutton',
                    itemId: 'doneButton',
                    text: this.selectionButtonText,
                    cls: 'primary rly-small',
                    scope: this,
                    disabled: !this.allowEmptyResponse,
                    userAction: 'clicked done in dialog',
                    handler: function() {
                        this.fireEvent('valuechosen', this, this.getSelectedRecords());
                        this.close();
                    }
                },
                {
                    xtype: 'rallybutton',
                    text: 'Cancel',
                    cls: 'secondary rly-small',
                    handler: this.close,
                    scope: this,
                    ui: 'link'
                }
            ]
        });

        if (this.introText) {
            this.addDocked({
                xtype: 'component',
                componentCls: 'intro-panel',
                html: this.introText
            });
        }
        this.addGrid();
        
    },
    
    addGrid: function() {
        var me = this;
        
        Rally.data.ModelFactory.getModel({
            type: me.artifactType,
            success: function(model) {
                var store = model.getField(me.artifactField).getAllowedValueStore();
                store.addFilter({ property:'StringValue',operator:'!=',value:'' });
                
                me.buildGrid(store);
            }
        });
    },

    buildGrid: function(store) {
        if (this.grid) {
            this.grid.destroy();
        }

        var me = this;
        var selectionConfig = {
            mode: this.multiple ? 'SIMPLE' : 'SINGLE',
            allowDeselect: true
        };
        this.grid = Ext.create('Rally.ui.grid.Grid', Ext.Object.merge({
            autoAddAllModelFieldsAsColumns: false,
            columnCfgs: [{dataIndex:'StringValue', text: 'Values'}],
            enableEditing: false,
            enableColumnHide: false,
            enableColumnMove: false,
            selModel: Ext.create('Rally.ui.selection.CheckboxModel', Ext.apply(selectionConfig, {
                enableKeyNav: false,
                isRowSelectable: function (record) {
                    return true;
                }
            })),
            showRowActionsColumn: false,
            store: store,
            viewConfig: {
                emptyText: Rally.ui.EmptyTextFactory.get('defaultText'),
                publishLoadMessages: false
            }
        }, this.config.gridConfig));
        
        this.mon(this.grid, {
            beforeselect: this._onGridSelect,
            beforedeselect: this._onGridDeselect,
            load: this._onGridLoad,
            scope: this
        });
        
        this.add(this.grid);
    },
    
    _onGridLoad: function() {
        this.selectionCache = [];
    },
    /**
     * Get the records currently selected in the dialog
     * {Rally.data.Model}|{Rally.data.Model[]}
     */
    getSelectedRecords: function() {
        return this.multiple ? this.selectionCache : this.selectionCache[0];
    },
    
    _enableDoneButton: function() {
        if ( this.allowEmptyResponse ) {
            return;
        }
        this.down('#doneButton').setDisabled(this.selectionCache.length ? false : true);
    },

    _findRecordInSelectionCache: function(record){
        return _.findIndex(this.selectionCache, function(cachedRecord) {
            return cachedRecord.get('StringValue') === record.get('StringValue');
        });
    },

    _onGridSelect: function(selectionModel, record) {
        var index = this._findRecordInSelectionCache(record);
        if (index === -1) {
            if (!this.multiple) {
                this.selectionCache = [];
            }
            this.selectionCache.push(record);
        }

        this._enableDoneButton();
    },

    _onGridDeselect: function(selectionModel, record) {
        var index = this._findRecordInSelectionCache(record);
        if (index !== -1) {
            this.selectionCache.splice(index, 1);
        }

        this._enableDoneButton();
    }
        
});
