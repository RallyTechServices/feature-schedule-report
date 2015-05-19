Ext.define("ts-feature-schedule-report", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

    portfolioItemFeature: 'PortfolioItem/Feature',
    featureFetchList: ['ObjectID','FormattedID','Name','c_FeatureTargetSprint','Project','State','c_CodeDeploymentSchedule','DisplayColor'],
    featureFetchHydrateList: ['Project'],
    pivotFieldName: 'c_FeatureTargetSprint',
    otherText: 'Needs Fixed',
    allReleasesText: 'All Releases',
    historicalDateRangeInDays: -14,

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
        var promises = [this._fetchFeatureData(), this._fetchHistoricalFeatureData()];
        Deft.Promise.all(promises).then({
            scope: this,
            success: function(recordsArray){
                this.logger.log('Promises success',recordsArray);
                var recordsObject = {currentRecords: recordsArray[0], historicalRecords: recordsArray[1]};
                this._createDataStore(recordsObject);
            },
            failure: function(operation){
                this.logger.log('Promise failure', operation);
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
            find = {
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
                    console.log('resolving records',records);
                    deferred.resolve(records);
                } else {
                    deferred.reject(operation);
                }
            }
        });
        return deferred;
    },
    _fetchPivotFields: function(){
        var deferred = Ext.create('Deft.Deferred');
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
        var releaseValue = this.down('#cb-release').getValue();
        var release = this.down('#cb-release').getRecord(),
            filters = [];
        this.logger.log('_getFilters',releaseValue);

        if (release){
            if (releaseValue.length > 0){  //releaseValue == '' for All releases
                filters = [{
                    property: 'Release.Name',
                    value: release.get('Name')
                },{
                    property: 'Release.ReleaseStartDate',
                    value: release.get('ReleaseStartDate')
                },{
                    property: 'Release.ReleaseDate',
                    value: release.get('ReleaseDate')
                }];

            }
        } else {  //Release record == null, which is unscheduled
            filters = [{
                property: 'Release',
                value: ''
            }];
        }

        var currentFilters = this.currentFilters || [];
        _.each(currentFilters, function(f){
            filters.push({
                property: f.property,
                operator: f.operator,
                value: f.value
            });
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
                    console.log(newObj.FormattedID, 'FLAGGED',snaps_by_oid[obj.get('ObjectID')]);
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
                this._createGrid(store, pivotFieldValues);
            }
        });
    },
    _createGrid: function(store, pivotFields) {
        this.logger.log('_createGrid',store);

        this.down('#ct-body').removeAll();

        this.down('#ct-body').add({
            xtype: 'rallygrid',
            columnCfgs: [
                {dataIndex: 'Project', text: 'Project'},
                {dataIndex: this.otherText, text: this.otherText, renderer: this._featureRenderer},
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
                        cds = '<img src="/slm/images/icon_alert_sm.gif" alt="CDS Missing" title="Warning: Code Deployment Schedule is missing!"><span class="ts-warning">Missing</span>';
                    }

                    var featureClass = v.Flagged ? 'tsflagged' : 'tscurrent';
                    msg += Ext.String.format('<div class="tscolor" style="background-color:{0};width:10px;height:10px;"></div><span class="{1}">{2}[{3}]{4}: {5}<br/><b><i>{6}</i></b></span><hr class="ts-separator"/>',
                        v.DisplayColor,
                        featureClass,
                        warning,
                        state,
                        v.FormattedID,
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

            this.down('#ct-header').add({
                xtype: 'rallybutton',
                itemId: 'btn-filter',
                scope: this,
                text: 'Filter',
                width: 75,
                margin: '0 10 10 10',
                handler: this._filter
            });
        }
    },
    _addAllOption: function(store){
        store.add({Name: this.allReleasesText, formattedName: this.allReleasesText});
    },
    _filter: function(){
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
                    this._updateApp();
                }
            }
        });
    }
});
