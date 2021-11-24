const { expect } = require('chai');
const { MockRuntime } = require('@axway/api-builder-test-utils');
const getPlugin = require('../src');
const fs = require('fs');
const client = require('prom-client');
const metricsRegistries = require('../src/metricsRegistries');

describe('flow-node prometheus-metrics', () => {
	let plugin;
	let flowNode;

	beforeEach(async () => {
		plugin = await MockRuntime.loadPlugin(getPlugin);
		plugin.setOptions({
			validateInputs: true,
			validateOutputs: true
		});
		flowNode = plugin.getFlowNode('prometheus-metrics');
	});

	describe('#constructor', () => {
		it('should define flow-nodes', () => {
			expect(plugin).to.be.a('object');
			expect(plugin.getFlowNodeIds()).to.deep.equal([
				'prometheus-metrics'
			]);
			expect(flowNode).to.be.a('object');
		});

		it('should define valid flow-nodes', () => {
			plugin.validate();
		});
	});

	describe('#processSystemOverviewMetrics', () => {
		it('should error when missing required parameter', async () => {
			// Disable automatic input validation (we want the action to handle this)
			plugin.setOptions({ validateInputs: false });

			const { value, output } = await flowNode.processSystemOverviewMetrics({
				systemOverviewMetrics: null
			});

			expect(value).to.be.instanceOf(Error)
				.and.to.have.property('message', 'Missing required parameter systemOverviewMetrics');
			expect(output).to.equal('error');
		});

		it('should collect all SystemOverview metrics', async () => {
			var testMetrics = JSON.parse(fs.readFileSync('./test/testFiles/SystemOverview/SystemOverviewTestMetrics.json'), null);
			
			const { value, output } = await flowNode.processSystemOverviewMetrics({ systemOverviewMetrics: testMetrics });
			expect(value).to.be.instanceOf(client.Registry);
			// Check some of the returned metrics
			var instanceCPUMetric = await value.getSingleMetric('gateway_instance_cpu').get();
			expect(instanceCPUMetric.type).to.equal('gauge');
			expect(instanceCPUMetric.values).to.lengthOf(2); // 2 API-Gateway instances
			expect(instanceCPUMetric.values).to.deep.equal(
				[ 
					{ labels: { instance: 'instance-50'}, value: 0 },
					{ labels: { instance: 'instance-1'}, value: 1 }
				]);
			expect(await value.getSingleMetric('gateway_instance_disk_used').get()).to.be.a('object');
			// As of now, SystemOverview is also used to get API-Requests information until this is fixed: https://support.axway.com/en/case-global/view/id/01314580
			var apiRequestsSuccess = await value.getSingleMetric('api_requests_success').get();
			var apiRequestsFailure = await value.getSingleMetric('api_requests_failures').get();
			var apiRequestsExceptions = await value.getSingleMetric('api_requests_exceptions').get();
			expect(apiRequestsSuccess.values).to.lengthOf(2); // Metrics for 2 API-Gateway expected
			expect(apiRequestsSuccess.values[0]).to.deep.equal( { labels: { 'instance': 'traffic-7cb4f6989f-bjw8n', "service": "Petstore"}, value: 20 });
			expect(output).to.equal('next');
		});
	});

	describe('#processServiceMetrics', () => {
		it('should error when missing required parameter', async () => {
			// Disable automatic input validation (we want the action to handle this)
			plugin.setOptions({ validateInputs: false });

			const { value, output } = await flowNode.processServiceMetrics({
				serviceMetrics: null
			});

			expect(value).to.be.instanceOf(Error)
				.and.to.have.property('message', 'Missing required parameter serviceMetrics');
			expect(output).to.equal('error');
		});

		it.only('should update the service registry based on the given service metrics', async () => {
			var testMetrics = JSON.parse(fs.readFileSync('./test/testFiles/Service/1_ServiceMetrics.json'), null);
			const { value, output } = await flowNode.processServiceMetrics({ serviceMetrics: testMetrics });

			expect(value).to.be.instanceOf(client.Registry);
			
			var apiRequestsTotal = await value.getSingleMetric('api_requests_total').get();
			var apiRequestsSuccess = await value.getSingleMetric('api_requests_success').get();
			var apiRequestsFailure = await value.getSingleMetric('api_requests_failures').get();
			var apiRequestsExceptions = await value.getSingleMetric('api_requests_exceptions').get();
			
			expect(apiRequestsTotal.type).to.equal('counter');
			expect(apiRequestsTotal.values).to.lengthOf(4); // 4 Metrics are expected
			expect(apiRequestsSuccess.values[0]).to.deep.equal( { labels: { 'instance': 'instance-1', "service": "Greeting API"}, value: 2078 });
			expect(apiRequestsFailure.values[0]).to.deep.equal( { labels: { 'instance': 'instance-1', "service": "Greeting API"}, value: 30 });
			expect(apiRequestsExceptions.values[0]).to.deep.equal( { labels: { 'instance': 'instance-1', "service": "Greeting API"}, value: 1 });

			expect(apiRequestsSuccess.values[1]).to.deep.equal( { labels: { 'instance': 'instance-1', "service": "Petstore"}, value: 888 });
			expect(apiRequestsFailure.values[1]).to.deep.equal( { labels: { 'instance': 'instance-1', "service": "Petstore"}, value: 4 });
			expect(apiRequestsExceptions.values[1]).to.deep.equal( { labels: { 'instance': 'instance-1', "service": "Petstore"}, value: 1 });

			expect(apiRequestsSuccess.values[2]).to.deep.equal( { labels: { 'instance': 'instance-2', "service": "FHIR CarePlan"}, value: 6 });
			expect(apiRequestsFailure.values[2]).to.deep.equal( { labels: { 'instance': 'instance-2', "service": "FHIR CarePlan"}, value: 0 });
			expect(apiRequestsExceptions.values[2]).to.deep.equal( { labels: { 'instance': 'instance-2', "service": "FHIR CarePlan"}, value: 0 });
			expect(output).to.equal('next');
		});
	});

	describe('#mergeRegistries', () => {
		var registry1 = new client.Registry();
		var registry2 = new client.Registry();

		// Register some dummy metrics, which can be validated in the merged registry
		var metric1 = new client.Gauge({registers: [], name: 'registry1_metric', help: 'A sample metric for registry 1'});
		registry1.registerMetric(metric1);
		var metric2 = new client.Gauge({registers: [], name: 'registry2_metric', help: 'A sample metric for registry 2'});
		registry2.registerMetric(metric2);

		// Get plugin with some simple test registries
		beforeEach(async () => {
			plugin = await MockRuntime.loadPlugin(getPlugin, { registries: [ registry1, registry2 ] });
			plugin.setOptions({
				validateInputs: true,
				validateOutputs: true
			});
			flowNode = plugin.getFlowNode('prometheus-metrics');
		});

		it('should merge two registries into one registry', async () => {
			const { value, output } = await flowNode.mergeRegistries();

			expect(value).to.be.instanceOf(client.Registry);

			expect(await value.getSingleMetric('registry1_metric').get()).to.be.a('object');
			expect(await value.getSingleMetric('registry2_metric').get()).to.be.a('object');
			expect(output).to.equal('next');
		});

		it('should merge two registries into one registry and return the metrics', async () => {
			const { value, output } = await flowNode.mergeRegistries( { returnMetrics: true });
			expect(value).to.equal(fs.readFileSync('./test/testFiles/Service/ExpectedPrometheusMetrics.txt', {encoding: 'UTF-8'} ));
			expect(output).to.equal('next');
		});
	});
});