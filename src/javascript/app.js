Ext.define("ts-feature-schedule-report", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

    portfolioItemFeature: 'PortfolioItem/Feature',
    featureFetchList: ['ObjectID','FormattedID','Name','c_FeatureTargetSprint','Project','State','c_CodeDeploymentSchedule','DisplayColor'],
    featureFetchHydrateList: ['Project'],
    pivotFieldName: 'c_FeatureTargetSprint',
    otherText: 'Fix Target Sprint',
    warningIcon: '<img src="/slm/images/icon_alert_sm.gif">',
    allReleasesText: 'All Releases',
    historicalDateRangeInDays: -14,
    
    timeboxType: 'targetSprint',
    timeboxNames: [],
    
    onNoAvailableTimeboxes: function(){
        this.logger.log('No available releases');
    },
    onScopeChange: function(cb){
        this.logger.log('onScopeChange', cb,cb.getValue());
        this._updateApp(cb.getRecord());
    },
    launch: function(){
        this._initLayoutComponents();
    },
    _updateApp: function(){
        this.logger.log('_updateApp');
        this.down('#ct-body').removeAll();
        this.setLoading({msg: 'Loading data...', fixed: true});

        var promises = [this._fetchFeatureData(), this._fetchHistoricalFeatureData()];
        Deft.Promise.all(promises).then({
            scope: this,
            success: function(recordsArray){
                this.logger.log('Promises success',recordsArray);
                var recordsObject = {currentRecords: recordsArray[0], historicalRecords: recordsArray[1]};
                this.setLoading(false);
                this._createDataStore(recordsObject);
            },
            failure: function(operation){
                this.logger.log('Promise failure', operation);
                this.setLoading(false);
                var msg =  'Error retrieving Portfolio Item data:  ';
                if (typeof operation === 'object'){
                   msg +=  operation.error.errors[0]
                } else {
                    msg += operation;
                }
                Rally.ui.notify.Notifier.showError({message: msg});
            }
        });
    },
    _getPreviousValuesPivotField: function(){
        return "_PreviousValues." + this.pivotFieldName;
    },
    _fetchHistoricalFeatureData: function(){
        var deferred = Ext.create('Deft.Deferred'),
            historicalDateRange = Rally.util.DateTime.toIsoString(Rally.util.DateTime.add(new Date(),"day",this.historicalDateRangeInDays)),
        fetchList = Ext.clone(this.featureFetchList);
        fetchList.push(this._getPreviousValuesPivotField());
        var find = {
                "_TypeHierarchy": this.PortfolioItemFeature,
                "_ValidTo": {$gte: historicalDateRange},
                "_ProjectHierarchy": this.getContext().getProject().ObjectID
            };
        find[this._getPreviousValuesPivotField()] = {$exists: true};

        var store = Ext.create('Rally.data.lookback.SnapshotStore',{
            limit: 'Infinity',
            findConfig:find,
            removeUnauthorizedSnapshots: true,
            fetch: fetchList,
            hydrate: this.featureFetchHydrateList
        });
        store.load({
            scope: this,
            callback: function(records, operation, success){
                this.logger.log('_fetchHistoricalFeatureData callback',success);
                if (success) {
                    deferred.resolve(records);
                } else {
                    deferred.reject(operation);
                }
            }
        });
        return deferred;
    },
    
    _fetchPivotFields: function() {
        var deferred = Ext.create('Deft.Deferred');
        
        var me = this;
        var pivotFieldName = this.pivotFieldName;

        Rally.data.wsapi.ModelFactory.getModel({
            type: this.portfolioItemFeature,
            success: function(model) {
                var field = model.getField(pivotFieldName);
                return field.getAllowedValueStore().load({
                    scope: this,
                    callback: function(records, operation, success){
                        if (success){
                            var pivotFields = [];
                            _.each(records, function(r){
                                if (r && r.get('StringValue') && r.get('StringValue').length > 0){
                                    pivotFields.push(r.get('StringValue'));
                                }
                            });
                            
                            if ( me.timeboxType != "Release" && me.timeboxNames.length > 0) {
                                pivotFields = Ext.Array.filter(pivotFields,function(field){
                                    return ( Ext.Array.contains(me.timeboxNames, field) ) ;
                                });
                            }
                            deferred.resolve(pivotFields);
                        } else {
                            deferred.reject(operation);
                        }
                    }
                });
            }
        });
        return deferred;
    },
    
    _getFilters: function(){
        var me = this;
        
        if ( this.timeboxType == "release" ) {

            var releaseValue = this.down('#cb-release').getValue();
            var release = this.down('#cb-release').getRecord(),
                filters = [];
            this.logger.log('_getFilters',releaseValue);
    
            if (release){
                if (releaseValue.length > 0){  //releaseValue == '' for All releases
                    filters = [{
                        property: 'Release.Name',
                        value: release.get('Name')
                    }];
                }
            } else {  //Release record == null, which is unscheduled
                filters = [{
                    property: 'Release',
                    value: ''
                }];
            }
        } else {
            if ( !Ext.isEmpty(this.timeboxNames) ) {
                filters = Ext.Array.map(this.timeboxNames, function(name){
                    return {property:me.pivotFieldName,value:name};
                });
            } else {
                filters = [{property:'ObjectID',operator: '>',value:0}];
            }
        }
        
        filters = Rally.data.wsapi.Filter.or(filters);
        
        var currentFilters = this.currentFilters || [];
        _.each(currentFilters, function(f){
            filters = filters.and(
                Ext.create('Rally.data.wsapi.Filter', {
                    property: f.property,
                    operator: f.operator,
                    value: f.value
                })
            );
        })
        
        

        this.logger.log('Filters', filters);
        return filters;

    },
    _fetchFeatureData: function(){
        var deferred = Ext.create('Deft.Deferred');

        var store = Ext.create('Rally.data.wsapi.Store',{
            model: this.portfolioItemFeature,
            fetch: this.featureFetchList,
            filters: this._getFilters(),
            context: {projectScopeDown: true},
            limit: 'Infinity'
        });

        return store.load({
            callback: function(records, operation, success){
                this.logger.log('_fetchFeatureData callback',success, operation);
                if (success){
                    deferred.resolve(records);
                } else {
                    deferred.reject(operation);
                }
            },
            scope: this
        });
        return deferred;
    },
    _buildDataStore: function(records, historicalRecords, pivotFieldValues){
        var projects = {},
            pivotFieldName = this.pivotFieldName;

        this.logger.log('_buildDataStore',records, historicalRecords,pivotFieldValues);

        _.each(records, function(r){
            var project_oid = r.get('Project')._ref;
            if (projects[project_oid] == undefined){
                projects[project_oid] = [];
            }
            projects[project_oid].push(r);
        });

        var snaps_by_oid = Rally.technicalservices.Toolbox.aggregateSnapsByOidForModel(historicalRecords);

        var otherText = this.otherText;

        var data = [];

        _.each(projects, function(objs, project_oid){
            var rec = {Project: objs[0].get('Project').Name};
            rec[otherText] = [];
            _.each(pivotFieldValues, function(pf){
                rec[pf] = [];
            });

            _.each(objs, function(obj){
                var newObj = obj.getData();
                if (snaps_by_oid[obj.get('ObjectID')]){
                    newObj.Flagged = true;
                }
                var pivotValue = obj.get(pivotFieldName) || otherText;
                if (_.indexOf(pivotFieldValues,pivotValue) >= 0){
                    rec[pivotValue].push(newObj);
                } else {
                    rec[otherText].push(newObj);
                }
            });

            data.push(rec);
        });

        this.logger.log('data for store', data);
        var otherStoriesExist = false;
        _.each(data, function(rec){
            if (rec[otherText] && rec[otherText].length > 0){
                otherStoriesExist = true;
            }
        });
        this.otherStoriesExist = otherStoriesExist;

        var store= Ext.create('Rally.data.custom.Store',{
            data: data,
            pageSize: data.length
        });
        return store;

    },
    _createDataStore: function(recordsObject) {
        var pivotFieldName = this.pivotFieldName,
            records = recordsObject.currentRecords,
            historicalRecords = recordsObject.historicalRecords;
        this.logger.log('_createDataStore');
        this._fetchPivotFields().then({
            scope: this,
            success: function(pivotFieldValues){
                var store = this._buildDataStore(records, historicalRecords, pivotFieldValues);
                this._createGrid(store, pivotFieldValues, this.otherStoriesExist);
            }
        });
    },

    _createGrid: function(store, pivotFields, otherStoriesExist) {
        this.logger.log('_createGrid',store);

        this.down('#ct-body').removeAll();

        this.down('#ct-body').add({
            xtype: 'rallygrid',
            columnCfgs: [
                {dataIndex: 'Project', text: 'Project', width: 200, tdCls: 'project'}/*,
                {
                    dataIndex: this.otherText,
                    text: this.otherText + this.warningIcon,
                    hidden: !otherStoriesExist,
                    renderer: this._featureRenderer
                }*/
            ].concat(_.map(pivotFields, function(pivotField) {
                    return {
                        dataIndex: pivotField,
                        flex: 1,
                        text: pivotField,
                        renderer: this._featureRenderer
                    };
                },this)),
            store: store,
            showPagingToolbar: false
        });
    },
    _featureRenderer: function(value, metadata, record){
        metadata.tdCls = 'ts-column-style';

        if (value && value.length > 0){
            var msg = '';
            _.each(value, function(v){
                var state = v.State ? v.State.Name : '',
                    cds = v.c_CodeDeploymentSchedule ? v.c_CodeDeploymentSchedule : 'Missing',
                    warning = '';
                if (v.c_CodeDeploymentSchedule){
                    cds = v.c_CodeDeploymentSchedule;
                } else {
                    cds = '<img src="/slm/images/icon_alert_sm.gif" alt="CDS Missing" title="Warning: Code Deployment Schedule is missing!"><span class="ts-warning">Missing Code Deployment Schedule</span>';
                }
                var link =  Rally.nav.DetailLink.getLink({record: v._ref, text: v.FormattedID});
                var featureClass = v.Flagged ? 'tsflagged' : 'tscurrent';
                msg += Ext.String.format('<div class="tscolor" style="background-color:{0};width:10px;height:10px;"></div><span class="{1}">{2}[{3}]&nbsp;{4}: {5}<br/><b><i>{6}</i></b></span><hr class="ts-separator"/>',
                    v.DisplayColor,
                    featureClass,
                    warning,
                    state,
                    link,
                    v.Name,
                    cds);

            });
            return msg.replace(/<hr class="ts-separator"\/>$/,'');
        }
        return '';

    },
    _initLayoutComponents: function(){
        //Add the high level body components if they haven't already been added.
        if (!this.down('tsinfolink')){
            this.add({xtype:'container',itemId:'ct-header', cls: 'header', layout: {type: 'hbox'}});
            this.add({xtype:'container',itemId:'ct-body'});
            this.add({xtype:'tsinfolink'});

            if ( this.timeboxType == "release" ) {
                this.down('#ct-header').add({
                    xtype: 'rallyreleasecombobox',
                    fieldLabel: 'Release',
                    itemId: 'cb-release',
                    labelAlign: 'right',
                    width: 300,
                    allowNoEntry: true,
                    storeConfig: {
                        listeners: {
                            scope: this,
                            load: this._addAllOption
                        }
                    },
                    listeners: {
                        scope: this,
                        change: this.onScopeChange
                    }
                });
            } else {
                this.down('#ct-header').add({
                    xtype:'rallybutton',
                    itemId: 'btn-target-sprints',
                    text: 'Choose TargetSprint(s)',
                    cls: 'small-icon secondary rly-small',
                    listeners: {
                        scope: this,
                        click: this._launchTargetSprintPicker
                    }
                });
            }

            this.down('#ct-header').add({
                xtype: 'rallybutton',
                itemId: 'btn-filter',
                scope: this,
                cls: 'small-icon secondary rly-small',
                iconCls: 'icon-filter',
                margin: '0 10 10 10',
                handler: this._filter
            });
            this.down('#ct-header').add({xtype:'container',
                itemId:'filter_box',
                margin: '0 10 10 10',
                tpl:'<div class="ts-filter"><i>Filters:&nbsp;<tpl for=".">{displayProperty} {operator} {displayValue}&nbsp;&nbsp;&nbsp;&nbsp;</tpl></i></div>'});

            this.down('#ct-header').add({
                xtype:'container',
                flex: 1,
                itemId:'spacer'
            });
            
            this.down('#ct-header').add({
                xtype:'container',
                width: 200,
                margin: '0 10 10 10',
                html: '<div class="legend">Text Color: <li><div class="tsflagged">Items have been pushed</div><li><div class="tscurrent">Current</div></div>'

            });
        }
    },
    _addAllOption: function(store){
        store.add({Name: this.allReleasesText, formattedName: this.allReleasesText});
    },
    
    _launchTargetSprintPicker: function(btn) {
        Ext.create('Rally.technicalservices.FieldValueDialog',{
            artifactType: 'PortfolioItem',
            artifactField: this.pivotFieldName,
            allowEmptyResponse: true,
            listeners: {
                scope: this,
                valuechosen: function(dialog,values) {
                    this.logger.log("Selected Values: ", values);
                    var string_values = Ext.Array.map(values, function(value) {
                        return value.get('StringValue');
                    })
                    this.timeboxNames = string_values;
                    if (Ext.isEmpty(this.timeboxNames)){
                        btn.removeCls('primary');
                        btn.addCls('secondary');
                    } else {
                        btn.removeCls('secondary');
                        btn.addCls('primary');
                    }
                    this._updateApp();
                }
            }
        }).show();
    },
    
    _filter: function(btn){
        this.logger.log('_filter', this.filterFields);
        Ext.create('Rally.technicalservices.dialog.Filter',{
            filters: this.currentFilters,
            title: 'Filter Features By',
            app: this,
            listeners: {
                scope: this,
                customFilter: function(filters){
                    this.logger.log('_filter event fired',filters);
                    this.currentFilters = filters;
                    if (filters.length == 0){
                        btn.removeCls('primary');
                        btn.addCls('secondary');
                        this.down('#filter_box').update('');
                    } else {
                        btn.removeCls('secondary');
                        btn.addCls('primary');
                        this.down('#filter_box').update(this.currentFilters);
                    }

                    this._updateApp();
                }
            }
        });
    }
});
