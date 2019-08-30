"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const chalk_1 = require("chalk");
const DomainInfo = require("./DomainInfo");
const DomainInfoWs = require("./DomainInfoWs");
const endpointTypes = {
    edge: "EDGE",
    regional: "REGIONAL",
};
const certStatuses = ["PENDING_VALIDATION", "ISSUED", "INACTIVE"];
class ServerlessCustomDomain {
    constructor(serverless, options) {
        this.serverless = serverless;
        this.options = options;
        this.commands = {
            create_domain: {
                lifecycleEvents: [
                    "create",
                    "initialize",
                ],
                usage: "Creates a domain using the domain name defined in the serverless file",
            },
            delete_domain: {
                lifecycleEvents: [
                    "delete",
                    "initialize",
                ],
                usage: "Deletes a domain using the domain name defined in the serverless file",
            },
        };
        this.hooks = {
            "after:deploy:deploy": this.hookWrapper.bind(this, this.setupMappings),
            "after:info:info": this.hookWrapper.bind(this, this.domainSummary),
            "before:remove:remove": this.hookWrapper.bind(this, this.removeMappings),
            "create_domain:create": this.hookWrapper.bind(this, this.createDomains),
            "delete_domain:delete": this.hookWrapper.bind(this, this.deleteDomains),
        };
    }
    /**
     * Wrapper for lifecycle function, initializes variables and checks if enabled.
     * @param lifecycleFunc lifecycle function that actually does desired action
     */
    hookWrapper(lifecycleFunc) {
        return __awaiter(this, void 0, void 0, function* () {
            this.initializeVariables();
            if (!this.enabled && !this.enabledWs) {
                this.serverless.cli.log("serverless-domain-manager: Custom domain generation is disabled.");
                return;
            }
            else if (!this.enabled) {
                this.serverless.cli.log("serverless-domain-manager: " +
                    "Custom domain creation for HTTP endpoints is disabled.");
            }
            else if (!this.enabledWs) {
                this.serverless.cli.log("serverless-domain-manager: " +
                    "Custom domain creation for websocket endpoints is disabled.");
            }
            return yield lifecycleFunc.call(this);
        });
    }
    /**
     * Lifecycle function to create a domain
     * Wraps creating a domain and resource record set
     */
    createDomain() {
        return __awaiter(this, void 0, void 0, function* () {
            let domainInfo;
            try {
                domainInfo = yield this.getDomainInfo();
            }
            catch (err) {
                if (err.message !== `Error: ${this.givenDomainName} not found.`) {
                    throw err;
                }
            }
            if (!domainInfo) {
                const certArn = yield this.getCertArn();
                domainInfo = yield this.createCustomDomain(certArn);
                yield this.changeResourceRecordSet("UPSERT", domainInfo);
                this.serverless.cli.log(`Custom domain ${this.givenDomainName} was created.
            New domains may take up to 40 minutes to be initialized.`);
            }
            else {
                this.serverless.cli.log(`Custom domain ${this.givenDomainName} already exists.`);
            }
        });
    }
    /**
     * Lifecycle function to delete a domain
     * Wraps deleting a domain and resource record set
     */
    deleteDomain() {
        return __awaiter(this, void 0, void 0, function* () {
            let domainInfo;
            try {
                domainInfo = yield this.getDomainInfo();
            }
            catch (err) {
                if (err.message === `Error: ${this.givenDomainName} not found.`) {
                    this.serverless.cli.log(`Unable to delete custom domain ${this.givenDomainName}: domain not found.`);
                    return;
                }
                throw err;
            }
            yield this.deleteCustomDomain();
            yield this.changeResourceRecordSet("DELETE", domainInfo);
            this.serverless.cli.log(`Custom domain ${this.givenDomainName} was deleted.`);
        });
    }
    /**
     * Lifecycle function to create basepath mapping
     * Wraps creation of basepath mapping and adds domain name info as output to cloudformation stack
     */
    setupBasePathMapping() {
        return __awaiter(this, void 0, void 0, function* () {
            // check if basepathmapping exists
            const restApiId = yield this.getRestApiId();
            const currentBasePath = yield this.getBasePathMapping(restApiId);
            // if basepath that matches restApiId exists, update; else, create
            if (!currentBasePath) {
                yield this.createBasePathMapping(restApiId);
            }
            else {
                yield this.updateBasePathMapping(currentBasePath);
            }
            const domainInfo = yield this.getDomainInfo();
            this.addOutputs(domainInfo);
            yield this.printDomainSummary(domainInfo);
        });
    }
    /**
     * Lifecycle function to delete basepath mapping
     * Wraps deletion of basepath mapping
     */
    removeBasePathMapping() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.deleteBasePathMapping();
        });
    }
    /**
     * Lifecycle function to print domain summary
     * Wraps printing of all domain manager related info
     */
    domainSummary() {
        return __awaiter(this, void 0, void 0, function* () {
            const domainInfo = yield this.getDomainInfo();
            const domainInfoWs = yield this.getDomainInfoWs();
            this.serverless.cli.consoleLog(chalk_1.default.yellow.underline("Serverless Domain Manager Summary"));
            if (domainInfo) {
                this.printDomainSummary(domainInfo);
                if (domainInfoWs) {
                    this.serverless.cli.consoleLog(chalk_1.default.yellow("---"));
                }
            }
            else {
                this.serverless.cli.log("Unable to print Serverless Domain Manager Summary for HTTP endpoints");
            }
            if (domainInfoWs) {
                this.printDomainSummaryWs(domainInfoWs);
            }
            else {
                this.serverless.cli.log("Unable to print Serverless Domain Manager Summary for websocket endpoints");
            }
        });
    }
    /**
     * Goes through custom domain property and initializes local variables and cloudformation template
     */
    initializeVariables() {
        this.enabled = this.evaluateEnabled();
        this.enabledWs = this.evaluateEnabledWs();
        let credentials;
        if (this.enabled || this.enabledWs) {
            credentials = this.serverless.providers.aws.getCredentials();
            this.route53 = new this.serverless.providers.aws.sdk.Route53(credentials);
            this.cloudformation = new this.serverless.providers.aws.sdk.CloudFormation(credentials);
        }
        if (this.enabled) {
            if (typeof this.serverless.service.custom.customDomain.domainName === "undefined") {
                //
                // ideally, an exception should be thrown right here but this would break unit tests (19.05.2019)
                // throw new ReferenceError("The Serverless key custom.customDomain.domainName is not initialized.");
                //
                this.serverless.cli.log(chalk_1.default.redBright("The Serverless key custom.customDomain.domainName " +
                    "is not initialized."));
            }
            this.apigateway = new this.serverless.providers.aws.sdk.APIGateway(credentials);
            this.givenDomainName = this.serverless.service.custom.customDomain.domainName;
            this.certificateName = this.serverless.service.custom.customDomain.certificateName;
            this.certificateArn = this.serverless.service.custom.customDomain.certificateArn;
            this.hostedZonePrivate = this.serverless.service.custom.customDomain.hostedZonePrivate;
            let basePath = this.serverless.service.custom.customDomain.basePath;
            if (basePath == null || basePath.trim() === "") {
                basePath = "(none)";
            }
            this.basePath = basePath;
            let stage = this.serverless.service.custom.customDomain.stage;
            if (typeof stage === "undefined") {
                stage = this.options.stage || this.serverless.service.provider.stage;
            }
            this.stage = stage;
            const endpointTypeWithDefault = this.serverless.service.custom.customDomain.endpointType ||
                endpointTypes.edge;
            const endpointTypeToUse = endpointTypes[endpointTypeWithDefault.toLowerCase()];
            if (!endpointTypeToUse) {
                throw new Error(`${endpointTypeWithDefault} is not supported endpointType, use edge or regional.`);
            }
            this.endpointType = endpointTypeToUse;
            this.acmRegion = this.endpointType === endpointTypes.regional ?
                this.serverless.providers.aws.getRegion() : "us-east-1";
            const acmCredentials = Object.assign({}, credentials, { region: this.acmRegion });
            this.acm = new this.serverless.providers.aws.sdk.ACM(acmCredentials);
        }
        if (this.enabledWs) {
            if (typeof this.serverless.service.custom.customDomain.websockets.domainName === "undefined") {
                // ideally, an exception should be thrown right here but this would break unit tests (19.05.2019)
                /*
                throw new ReferenceError("The Serverless key custom.customDomain.websockets.domainName " +
                                         "is not initialized but the domain creation is enabled.");
                */
                this.serverless.cli.log(chalk_1.default.redBright("The Serverless key " +
                    "custom.customDomain.websockets.domainName " +
                    "is not initialized but the domain creation is enabled."));
            }
            this.apigatewayv2 = new this.serverless.providers.aws.sdk.ApiGatewayV2(credentials);
            this.givenDomainNameWs = this.serverless.service.custom.customDomain.websockets.domainName;
            this.certificateNameWs = this.serverless.service.custom.customDomain.websockets.certificateName;
            this.certificateArnWs = this.serverless.service.custom.customDomain.websockets.certificateArn;
            this.hostedZonePrivateWs = this.serverless.service.custom.customDomain.websockets.hostedZonePrivate;
            let basePath = this.serverless.service.custom.customDomain.websockets.basePath;
            if (basePath == null || basePath.trim() === "") {
                basePath = "(none)";
            }
            this.basePathWs = basePath;
            let stage = this.serverless.service.custom.customDomain.websockets.stage;
            if (typeof stage === "undefined") {
                stage = this.options.stage || this.serverless.service.provider.stage;
            }
            this.stageWs = stage;
            let endpointTypeWithDefault = this.serverless.service.custom.customDomain.websockets.endpointType ||
                endpointTypes.regional;
            if (endpointTypeWithDefault !== endpointTypes.regional) {
                this.logIfDebug("Only regional websocket endpoints are supported by AWS now, " +
                    "setting websockets.endpointType to regional and proceeding.");
                endpointTypeWithDefault = endpointTypes.regional;
            }
            const endpointTypeToUse = endpointTypes[endpointTypeWithDefault.toLowerCase()];
            if (!endpointTypeToUse) {
                throw new Error(`${endpointTypeWithDefault} is not supported endpointType, use edge or regional.`);
            }
            this.endpointTypeWs = endpointTypeToUse;
            this.acmRegionWs = this.endpointTypeWs === endpointTypes.regional ?
                this.serverless.providers.aws.getRegion() : "us-east-1";
            const acmCredentialsWs = Object.assign({}, credentials, { region: this.acmRegionWs });
            this.acmWs = new this.serverless.providers.aws.sdk.ACM(acmCredentialsWs);
        }
    }
    /**
     * Determines whether this plug-in is enabled.
     *
     * This method reads the customDomain property "enabled" to see if this plug-in should be enabled.
     * If the property's value is undefined, a default value of true is assumed (for backwards
     * compatibility).
     * If the property's value is provided, this should be boolean, otherwise an exception is thrown.
     * If no customDomain object exists, an exception is thrown.
     */
    evaluateEnabled() {
        if (typeof this.serverless.service.custom === "undefined"
            || typeof this.serverless.service.custom.customDomain === "undefined") {
            throw new Error("serverless-domain-manager: Plugin configuration is missing.");
        }
        const enabled = this.serverless.service.custom.customDomain.enabled;
        if (enabled === undefined) {
            return true;
        }
        if (typeof enabled === "boolean") {
            return enabled;
        }
        else if (typeof enabled === "string" && enabled === "true") {
            return true;
        }
        else if (typeof enabled === "string" && enabled === "false") {
            return false;
        }
        throw new Error(`serverless-domain-manager: Ambiguous enablement boolean: "${enabled}"`);
    }
    /**
     * Gets Certificate ARN that most closely matches domain name OR given Cert ARN if provided
     */
    getCertArn() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.serverless.service.custom.customDomain.certificateArn) {
                this.serverless.cli.log(`Selected specific certificateArn ${this.serverless.service.custom.customDomain.certificateArn}`);
                return this.serverless.service.custom.customDomain.certificateArn;
            }
            let certificateArn; // The arn of the choosen certificate
            let certificateName = this.serverless.service.custom.customDomain.certificateName; // The certificate name
            let certData;
            try {
                certData = yield this.acm.listCertificates({ CertificateStatuses: certStatuses }).promise();
                // The more specific name will be the longest
                let nameLength = 0;
                const certificates = certData.CertificateSummaryList;
                // Checks if a certificate name is given
                if (certificateName != null) {
                    const foundCertificate = certificates
                        .find((certificate) => (certificate.DomainName === certificateName));
                    if (foundCertificate != null) {
                        certificateArn = foundCertificate.CertificateArn;
                    }
                }
                else {
                    certificateName = this.givenDomainName;
                    certificates.forEach((certificate) => {
                        let certificateListName = certificate.DomainName;
                        // Looks for wild card and takes it out when checking
                        if (certificateListName[0] === "*") {
                            certificateListName = certificateListName.substr(1);
                        }
                        // Looks to see if the name in the list is within the given domain
                        // Also checks if the name is more specific than previous ones
                        if (certificateName.includes(certificateListName)
                            && certificateListName.length > nameLength) {
                            nameLength = certificateListName.length;
                            certificateArn = certificate.CertificateArn;
                        }
                    });
                }
            }
            catch (err) {
                this.logIfDebug(err);
                throw Error(`Error: Could not list certificates in Certificate Manager.\n${err}`);
            }
            if (certificateArn == null) {
                throw Error(`Error: Could not find the certificate ${certificateName}.`);
            }
            return certificateArn;
        });
    }
    /**
     * Gets domain info as DomainInfo object if domain exists, otherwise returns false
     */
    getDomainInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            let domainInfo;
            try {
                domainInfo = yield this.apigateway.getDomainName({ domainName: this.givenDomainName }).promise();
                return new DomainInfo(domainInfo);
            }
            catch (err) {
                this.logIfDebug(err);
                if (err.code === "NotFoundException") {
                    throw new Error(`Error: ${this.givenDomainName} not found.`);
                }
                throw new Error(`Error: Unable to fetch information about ${this.givenDomainName}`);
            }
        });
    }
    /**
     * Creates Custom Domain Name through API Gateway
     * @param certificateArn: Certificate ARN to use for custom domain
     */
    createCustomDomain(certificateArn) {
        return __awaiter(this, void 0, void 0, function* () {
            // Set up parameters
            const params = {
                certificateArn,
                domainName: this.givenDomainName,
                endpointConfiguration: {
                    types: [this.endpointType],
                },
                regionalCertificateArn: certificateArn,
            };
            if (this.endpointType === endpointTypes.edge) {
                params.regionalCertificateArn = undefined;
            }
            else if (this.endpointType === endpointTypes.regional) {
                params.certificateArn = undefined;
            }
            // Make API call
            let createdDomain = {};
            try {
                createdDomain = yield this.apigateway.createDomainName(params).promise();
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Failed to create custom domain ${this.givenDomainName}\n`);
            }
            return new DomainInfo(createdDomain);
        });
    }
    /**
     * Delete Custom Domain Name through API Gateway
     */
    deleteCustomDomain() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                domainName: this.givenDomainName,
            };
            // Make API call
            try {
                yield this.apigateway.deleteDomainName(params).promise();
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Failed to delete custom domain ${this.givenDomainName}\n`);
            }
        });
    }
    /**
     * Change A Alias record through Route53 based on given action
     * @param action: String descriptor of change to be made. Valid actions are ['UPSERT', 'DELETE']
     * @param domain: DomainInfo object containing info about custom domain
     */
    changeResourceRecordSet(action, domain) {
        return __awaiter(this, void 0, void 0, function* () {
            if (action !== "UPSERT" && action !== "DELETE") {
                throw new Error(`Error: Invalid action "${action}" when changing Route53 Record.
                Action must be either UPSERT or DELETE.\n`);
            }
            const actionMap = {
                DELETE: "deletion",
                UPSERT: "creation",
            };
            const createRoute53Record = this.serverless.service.custom.customDomain.createRoute53Record;
            if (createRoute53Record !== undefined && createRoute53Record === false) {
                this.serverless.cli.log(`Skipping ${actionMap[action]} of Route53 record.`);
                return;
            }
            // Set up parameters
            const route53HostedZoneId = yield this.getRoute53HostedZoneId();
            const Changes = ["A", "AAAA"].map((Type) => ({
                Action: action,
                ResourceRecordSet: {
                    AliasTarget: {
                        DNSName: domain.domainName,
                        EvaluateTargetHealth: false,
                        HostedZoneId: domain.hostedZoneId,
                    },
                    Name: this.givenDomainName,
                    Type,
                },
            }));
            const params = {
                ChangeBatch: {
                    Changes,
                    Comment: "Record created by serverless-domain-manager",
                },
                HostedZoneId: route53HostedZoneId,
            };
            // Make API call
            try {
                yield this.route53.changeResourceRecordSets(params).promise();
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Failed to ${action} A Alias for ${this.givenDomainName}\n`);
            }
        });
    }
    /**
     * Gets Route53 HostedZoneId from user or from AWS
     */
    getRoute53HostedZoneId() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.serverless.service.custom.customDomain.hostedZoneId) {
                this.serverless.cli.log(`Selected specific hostedZoneId ${this.serverless.service.custom.customDomain.hostedZoneId}`);
                return this.serverless.service.custom.customDomain.hostedZoneId;
            }
            const filterZone = this.hostedZonePrivate !== undefined;
            if (filterZone && this.hostedZonePrivate) {
                this.serverless.cli.log("Filtering to only private zones.");
            }
            else if (filterZone && !this.hostedZonePrivate) {
                this.serverless.cli.log("Filtering to only public zones.");
            }
            let hostedZoneData;
            const givenDomainNameReverse = this.givenDomainName.split(".").reverse();
            try {
                hostedZoneData = yield this.route53.listHostedZones({}).promise();
                const targetHostedZone = hostedZoneData.HostedZones
                    .filter((hostedZone) => {
                    let hostedZoneName;
                    if (hostedZone.Name.endsWith(".")) {
                        hostedZoneName = hostedZone.Name.slice(0, -1);
                    }
                    else {
                        hostedZoneName = hostedZone.Name;
                    }
                    if (!filterZone || this.hostedZonePrivate === hostedZone.Config.PrivateZone) {
                        const hostedZoneNameReverse = hostedZoneName.split(".").reverse();
                        if (givenDomainNameReverse.length === 1
                            || (givenDomainNameReverse.length >= hostedZoneNameReverse.length)) {
                            for (let i = 0; i < hostedZoneNameReverse.length; i += 1) {
                                if (givenDomainNameReverse[i] !== hostedZoneNameReverse[i]) {
                                    return false;
                                }
                            }
                            return true;
                        }
                    }
                    return false;
                })
                    .sort((zone1, zone2) => zone2.Name.length - zone1.Name.length)
                    .shift();
                if (targetHostedZone) {
                    const hostedZoneId = targetHostedZone.Id;
                    // Extracts the hostzone Id
                    const startPos = hostedZoneId.indexOf("e/") + 2;
                    const endPos = hostedZoneId.length;
                    return hostedZoneId.substring(startPos, endPos);
                }
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Unable to list hosted zones in Route53.\n${err}`);
            }
            throw new Error(`Error: Could not find hosted zone "${this.givenDomainName}"`);
        });
    }
    getBasePathMapping(restApiId) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                domainName: this.givenDomainName,
            };
            let basepathInfo;
            let currentBasePath;
            try {
                basepathInfo = yield this.apigateway.getBasePathMappings(params).promise();
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Unable to get BasePathMappings for ${this.givenDomainName}`);
            }
            if (basepathInfo.items !== undefined && basepathInfo.items instanceof Array) {
                for (const basepathObj of basepathInfo.items) {
                    if (basepathObj.restApiId === restApiId) {
                        currentBasePath = basepathObj.basePath;
                        break;
                    }
                }
            }
            return currentBasePath;
        });
    }
    /**
     * Creates basepath mapping
     */
    createBasePathMapping(restApiId) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                basePath: this.basePath,
                domainName: this.givenDomainName,
                restApiId,
                stage: this.stage,
            };
            // Make API call
            try {
                yield this.apigateway.createBasePathMapping(params).promise();
                this.serverless.cli.log("Created basepath mapping.");
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Unable to create basepath mapping.\n`);
            }
        });
    }
    /**
     * Updates basepath mapping
     */
    updateBasePathMapping(oldBasePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                basePath: oldBasePath,
                domainName: this.givenDomainName,
                patchOperations: [
                    {
                        op: "replace",
                        path: "/basePath",
                        value: this.basePath,
                    },
                ],
            };
            // Make API call
            try {
                yield this.apigateway.updateBasePathMapping(params).promise();
                this.serverless.cli.log("Updated basepath mapping.");
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Unable to update basepath mapping.\n`);
            }
        });
    }
    /**
     * Gets rest API id from CloudFormation stack
     */
    getRestApiId() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.serverless.service.provider.apiGateway && this.serverless.service.provider.apiGateway.restApiId) {
                this.serverless.cli.log(`Mapping custom domain to existing API
                ${this.serverless.service.provider.apiGateway.restApiId}.`);
                return this.serverless.service.provider.apiGateway.restApiId;
            }
            const stackName = this.serverless.service.provider.stackName ||
                `${this.serverless.service.service}-${this.stage}`;
            const params = {
                LogicalResourceId: "ApiGatewayRestApi",
                StackName: stackName,
            };
            let response;
            try {
                response = yield this.cloudformation.describeStackResource(params).promise();
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Failed to find CloudFormation resources for ${this.givenDomainName}\n`);
            }
            const restApiId = response.StackResourceDetail.PhysicalResourceId;
            if (!restApiId) {
                throw new Error(`Error: No RestApiId associated with CloudFormation stack ${stackName}`);
            }
            return restApiId;
        });
    }
    /**
     * Deletes basepath mapping
     */
    deleteBasePathMapping() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                basePath: this.basePath,
                domainName: this.givenDomainName,
            };
            // Make API call
            try {
                yield this.apigateway.deleteBasePathMapping(params).promise();
                this.serverless.cli.log("Removed basepath mapping.");
            }
            catch (err) {
                this.logIfDebug(err);
                this.serverless.cli.log("Unable to remove basepath mapping.");
            }
        });
    }
    /**
     *  Adds the domain name and distribution domain name to the CloudFormation outputs
     */
    addOutputs(domainInfo) {
        const service = this.serverless.service;
        if (!service.provider.compiledCloudFormationTemplate.Outputs) {
            service.provider.compiledCloudFormationTemplate.Outputs = {};
        }
        service.provider.compiledCloudFormationTemplate.Outputs.DomainName = {
            Value: domainInfo.domainName,
        };
        if (domainInfo.hostedZoneId) {
            service.provider.compiledCloudFormationTemplate.Outputs.HostedZoneId = {
                Value: domainInfo.hostedZoneId,
            };
        }
    }
    /**
     * Logs message if SLS_DEBUG is set
     * @param message message to be printed
     */
    logIfDebug(message) {
        if (process.env.SLS_DEBUG) {
            this.serverless.cli.log(message, "Serverless Domain Manager");
        }
    }
    /**
     * Determines whether this plug-in is enabled for a websocket endpoint
     *
     * This method reads the customDomain.websockets property "enabled" to see if this plug-in should be enabled.
     * If the property's value is undefined, a default value of true is assumed (for backwards
     * compatibility).
     * If the property's value is provided, this should be boolean, otherwise an exception is thrown.
     * If no customDomain.websockets object exists, websocket creation is disabled.
     */
    evaluateEnabledWs() {
        if (typeof this.serverless.service.custom === "undefined"
            || typeof this.serverless.service.custom.customDomain === "undefined") {
            throw new Error("serverless-domain-manager: Plugin configuration is missing.");
        }
        // disable websocket domain creation if configuration missing
        if (typeof this.serverless.service.custom.customDomain.websockets === "undefined"
            || this.serverless.service.custom.customDomain.websockets == null) {
            return false;
        }
        const enabled = this.serverless.service.custom.customDomain.websockets.enabled;
        if (enabled === undefined) {
            return true;
        }
        if (typeof enabled === "boolean") {
            return enabled;
        }
        else if (typeof enabled === "string" && enabled === "true") {
            return true;
        }
        else if (typeof enabled === "string" && enabled === "false") {
            return false;
        }
        throw new Error(`serverless-domain-manager: Ambiguous enablement boolean: "${enabled}"`);
    }
    /**
     * Returns information about custom domain name registered in ApiGatewayV2
     */
    getDomainInfoWs() {
        return __awaiter(this, void 0, void 0, function* () {
            let domainInfo;
            const params = {
                DomainName: this.givenDomainNameWs,
            };
            try {
                domainInfo = yield this.apigatewayv2.getDomainName(params).promise();
                return new DomainInfoWs(domainInfo);
            }
            catch (err) {
                if (err.code === "NotFoundException") {
                    throw new Error(`Error: Domain name ${params.DomainName} not found.`);
                }
                throw new Error(`Error: Unable to fetch information about ${params.DomainName}`);
            }
        });
    }
    /**
     * Gets Certificate ARN of a websocket custom domain
     * that most closely matches domain name OR given Cert ARN if provided
     */
    getCertArnWs() {
        return __awaiter(this, void 0, void 0, function* () {
            let certificateArn = this.certificateArnWs; // The arn of the choosen certificate
            let certificateName = this.certificateNameWs; // The certificate name
            let certData;
            if (this.serverless.service.custom.customDomain.websockets.certificateArn) {
                this.serverless.cli.log("Selected specific certificateArn " +
                    `${this.serverless.service.custom.customDomain.websockets.certificateArn}`);
                return this.serverless.service.custom.customDomain.websockets.certificateArn;
            }
            try {
                certData = yield this.acmWs.listCertificates({ CertificateStatuses: certStatuses }).promise();
                // The more specific name will be the longest
                let nameLength = 0;
                const certificates = certData.CertificateSummaryList;
                // Checks if a certificate name is given
                if (certificateName != null) {
                    const foundCertificate = certificates
                        .find((certificate) => (certificate.DomainName === certificateName));
                    if (foundCertificate != null) {
                        certificateArn = foundCertificate.CertificateArn;
                    }
                }
                else {
                    certificateName = this.givenDomainNameWs;
                    certificates.forEach((certificate) => {
                        let certificateListName = certificate.DomainName;
                        // Looks for wild card and takes it out when checking
                        if (certificateListName[0] === "*") {
                            certificateListName = certificateListName.substr(1);
                        }
                        // Looks to see if the name in the list is within the given domain
                        // Also checks if the name is more specific than previous ones
                        if (certificateName.includes(certificateListName)
                            && certificateListName.length > nameLength) {
                            nameLength = certificateListName.length;
                            certificateArn = certificate.CertificateArn;
                        }
                    });
                }
            }
            catch (err) {
                throw Error(`Error: Could not list certificates in Certificate Manager.\n${err}`);
            }
            if (certificateArn == null) {
                throw Error(`Error: Could not find the certificate ${certificateName}.`);
            }
            return certificateArn;
        });
    }
    /**
     * Creates Custom Domain Name for a websocket endpoint through API Gateway V2
     * @param certificateArn: Certificate ARN to use for custom domain
     */
    createCustomDomainWs(certificateArn) {
        return __awaiter(this, void 0, void 0, function* () {
            // Set up parameters
            const params = {
                DomainName: this.givenDomainNameWs,
                DomainNameConfigurations: [
                    {
                        CertificateArn: certificateArn,
                        CertificateName: this.certificateNameWs,
                    },
                ],
            };
            // Make API call
            let createdDomain = {};
            try {
                createdDomain = yield this.apigatewayv2.createDomainName(params).promise();
            }
            catch (err) {
                throw new Error(`Error: Failed to create custom domain ${params.DomainName}\n`);
            }
            return new DomainInfoWs(createdDomain);
        });
    }
    /**
     * Gets Route53 HostedZoneId for a websocket custom domain name from user or from AWS
     */
    getRoute53HostedZoneIdWs() {
        return __awaiter(this, void 0, void 0, function* () {
            const givenHostedZoneId = this.serverless.service.custom.customDomain.websockets.hostedZoneId;
            if (givenHostedZoneId) {
                this.serverless.cli.log(`Selected specific hostedZoneId ${givenHostedZoneId}`);
                return givenHostedZoneId;
            }
            const hostedZonePrivate = this.hostedZonePrivateWs;
            const filterZone = hostedZonePrivate !== undefined;
            if (filterZone && hostedZonePrivate) {
                this.serverless.cli.log("Filtering to only private zones.");
            }
            else if (filterZone && !hostedZonePrivate) {
                this.serverless.cli.log("Filtering to only public zones.");
            }
            let hostedZoneData;
            const givenDomainNameReverse = this.givenDomainNameWs.split(".").reverse();
            try {
                hostedZoneData = yield this.route53.listHostedZones({}).promise();
                const targetHostedZone = hostedZoneData.HostedZones
                    .filter((hostedZone) => {
                    let hostedZoneName;
                    if (hostedZone.Name.endsWith(".")) {
                        hostedZoneName = hostedZone.Name.slice(0, -1);
                    }
                    else {
                        hostedZoneName = hostedZone.Name;
                    }
                    if (!filterZone || hostedZonePrivate === hostedZone.Config.PrivateZone) {
                        const hostedZoneNameReverse = hostedZoneName.split(".").reverse();
                        if (givenDomainNameReverse.length === 1
                            || (givenDomainNameReverse.length >= hostedZoneNameReverse.length)) {
                            for (let i = 0; i < hostedZoneNameReverse.length; i += 1) {
                                if (givenDomainNameReverse[i] !== hostedZoneNameReverse[i]) {
                                    return false;
                                }
                            }
                            return true;
                        }
                    }
                    return false;
                })
                    .sort((zone1, zone2) => zone2.Name.length - zone1.Name.length)
                    .shift();
                if (targetHostedZone) {
                    const hostedZoneId = targetHostedZone.Id;
                    // Extracts the hostzone Id
                    const startPos = hostedZoneId.indexOf("e/") + 2;
                    const endPos = hostedZoneId.length;
                    return hostedZoneId.substring(startPos, endPos);
                }
            }
            catch (err) {
                throw new Error(`Error: Unable to list hosted zones in Route53.\n${err}`);
            }
            throw new Error(`Error: Could not find hosted zone "${this.givenDomainNameWs}"`);
        });
    }
    /**
     * Change A Alias record through Route53 based on given action
     * @param action: String descriptor of change to be made. Valid actions are ['UPSERT', 'DELETE']
     * @param domain: DomainInfoWs object containing info about websocket custom domain
     */
    changeResourceRecordSetWs(action, domain) {
        return __awaiter(this, void 0, void 0, function* () {
            if (action !== "UPSERT" && action !== "DELETE") {
                throw new Error(`Error: Invalid action "${action}" when changing Route53 Record.
                Action must be either UPSERT or DELETE.\n`);
            }
            const actionMap = {
                DELETE: "deletion",
                UPSERT: "creation",
            };
            const createRoute53Record = this.serverless.service.custom.customDomain.websockets.createRoute53Record;
            if (createRoute53Record !== undefined && createRoute53Record === false) {
                this.serverless.cli.log(`Skipping ${actionMap[action]} of Route53 record.`);
                return;
            }
            // Set up parameters
            const route53HostedZoneId = yield this.getRoute53HostedZoneIdWs();
            const Changes = ["A", "AAAA"].map((Type) => ({
                Action: action,
                ResourceRecordSet: {
                    AliasTarget: {
                        DNSName: domain.apiGatewayDomainName,
                        EvaluateTargetHealth: false,
                        HostedZoneId: domain.hostedZoneId,
                    },
                    Name: this.givenDomainNameWs,
                    Type,
                },
            }));
            const params = {
                ChangeBatch: {
                    Changes,
                    Comment: "Record created by serverless-domain-manager",
                },
                HostedZoneId: route53HostedZoneId,
            };
            // Make API call
            try {
                yield this.route53.changeResourceRecordSets(params).promise();
            }
            catch (err) {
                throw new Error(`Error: Failed to ${action} A Alias for ${this.givenDomainNameWs}\n`);
            }
        });
    }
    /**
     * Wrapper function to create a websocket custom domain and a corresponding Route53 record
     */
    createDomainWs() {
        return __awaiter(this, void 0, void 0, function* () {
            let domainInfo;
            const givenDomainName = this.givenDomainNameWs;
            try {
                domainInfo = yield this.getDomainInfoWs();
            }
            catch (err) {
                if (err.message !== `Error: Domain name ${givenDomainName} not found.`) {
                    throw err;
                }
            }
            if (!domainInfo) {
                const certArn = yield this.getCertArnWs();
                domainInfo = yield this.createCustomDomainWs(certArn);
                yield this.changeResourceRecordSetWs("UPSERT", domainInfo);
                this.serverless.cli.log(`Custom domain ${this.givenDomainNameWs} was created.
            New domains may take up to 40 minutes to be initialized.`);
            }
            else {
                this.serverless.cli.log(`Custom domain ${givenDomainName} already exists.`);
            }
        });
    }
    /**
     * Delete a websocket Custom Domain Name through API Gateway V2
     */
    deleteCustomDomainWs() {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                DomainName: this.givenDomainNameWs,
            };
            // Make API call
            try {
                yield this.apigatewayv2.deleteDomainName(params).promise();
            }
            catch (err) {
                throw new Error(`Error: Failed to delete custom domain ${params.DomainName}\n`);
            }
        });
    }
    /**
     * Wrapper function to delete a websocket custom domain and a corresponding Route53 record
     */
    deleteDomainWs() {
        return __awaiter(this, void 0, void 0, function* () {
            let domainInfo;
            const givenDomainName = this.givenDomainNameWs;
            try {
                domainInfo = yield this.getDomainInfoWs();
            }
            catch (err) {
                if (err.message === `Error: Domain name ${givenDomainName} not found.`) {
                    this.serverless.cli.log(`Unable to delete custom domain ${givenDomainName}: domain not found.`);
                    return;
                }
                throw err;
            }
            yield this.deleteCustomDomainWs();
            yield this.changeResourceRecordSetWs("DELETE", domainInfo);
            this.serverless.cli.log(`Custom domain ${givenDomainName} was deleted.`);
        });
    }
    /**
     * Gets websocket API ID from CloudFormation stack for the custom domain to be mapped on
     */
    getWssApiId() {
        return __awaiter(this, void 0, void 0, function* () {
            const stackName = this.serverless.service.provider.stackName ||
                `${this.serverless.service.service}-${this.stage}`;
            const params = {
                LogicalResourceId: "WebsocketsApi",
                StackName: stackName,
            };
            let response;
            try {
                response = yield this.cloudformation.describeStackResource(params).promise();
            }
            catch (err) {
                throw new Error(`Error: Failed to find CloudFormation resources for ${this.givenDomainNameWs}\n`);
            }
            const wssApiId = response.StackResourceDetail.PhysicalResourceId;
            if (!wssApiId) {
                throw new Error(`Error: No WssApiId associated with CloudFormation stack ${stackName}`);
            }
            return wssApiId;
        });
    }
    /**
     * Gets existing websocket API mappings in API gateway V2 for a given custom domain name
     * @param wssApiId: ID of the existing websocket API in the CloudFormation stack
     */
    getApiMappingWs(wssApiId) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                DomainName: this.givenDomainNameWs,
            };
            let apiInfo;
            let currentApiMappingId;
            try {
                apiInfo = yield this.apigatewayv2.getApiMappings(params).promise();
            }
            catch (err) {
                throw new Error(`Error: Unable to get ApiMappings for ${params.DomainName}`);
            }
            if (apiInfo.Items !== undefined && apiInfo.Items instanceof Array && apiInfo.Items[0] !== undefined) {
                const apiItems = apiInfo.Items[0];
                if (apiItems.ApiId === wssApiId) {
                    currentApiMappingId = apiItems.ApiMappingId;
                }
                else {
                    currentApiMappingId = undefined;
                }
            }
            return currentApiMappingId;
        });
    }
    /**
     * Creates an API mapping for a custom domain using API gateway V2
     * @param wssApiId: ID of the existing websocket API in the CloudFormation stack
     */
    createApiMappingWs(wssApiId) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                ApiId: wssApiId,
                ApiMappingKey: "",
                DomainName: this.givenDomainNameWs,
                Stage: this.stageWs,
            };
            // Make API call
            let apiMapping;
            try {
                apiMapping = yield this.apigatewayv2.createApiMapping(params).promise();
                this.serverless.cli.log("Created API mapping.");
            }
            catch (err) {
                throw new Error(`Error: Unable to create an API mapping.\n`);
            }
            return apiMapping;
        });
    }
    /**
     * Updates existing websocket API mapping using API gateway V2
     * @param wssApiId: ID of a websocket API for the custom domain to be mapped on
     * @param apiMappingId: ID of an already existing API mapping in API gateway V2
     */
    updateApiMappingWs(wssApiId, apiMappingId) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                ApiId: wssApiId,
                ApiMappingId: apiMappingId,
                ApiMappingKey: "",
                DomainName: this.givenDomainNameWs,
                Stage: this.stageWs,
            };
            // Make API call
            try {
                yield this.apigatewayv2.updateApiMapping(params).promise();
                this.serverless.cli.log("Updated API mapping.");
            }
            catch (err) {
                throw new Error(`Error: Unable to update API mapping.\n`);
            }
        });
    }
    /**
     * Deletes existing websocket API mapping using API gateway V2
     * @param wssApiId: ID of a websocket API which the custom domain is mapped on
     * @param apiMappingId: ID of an already existing API mapping in API gateway V2
     */
    deleteApiMappingWs(wssApiId, apiMappingId) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                ApiId: wssApiId,
                ApiMappingId: apiMappingId,
                DomainName: this.givenDomainNameWs,
            };
            // Make API call
            try {
                yield this.apigatewayv2.deleteApiMapping(params).promise();
                this.serverless.cli.log("Removed basepath mapping.");
            }
            catch (err) {
                this.serverless.cli.log("Unable to remove basepath mapping.");
            }
        });
    }
    /**
     * Lifecycle function to setup a websocket API mapping
     * Wraps creation of an API mapping and adds domain name info as output to cloudformation stack
     */
    setupApiMappingWs() {
        return __awaiter(this, void 0, void 0, function* () {
            let wssApiId;
            let currentApiMappingId;
            try {
                wssApiId = yield this.getWssApiId();
                currentApiMappingId = yield this.getApiMappingWs(wssApiId);
            }
            catch (ex) {
                this.logIfDebug(ex.message);
            }
            this.logIfDebug(`Found websocket API ID: ${wssApiId}`);
            this.logIfDebug(`Found API mapping ID for the websocket API: ${currentApiMappingId}`);
            let apiMapping;
            if (!currentApiMappingId) {
                apiMapping = yield this.createApiMappingWs(wssApiId);
            }
            else {
                apiMapping = yield this.updateApiMappingWs(wssApiId, currentApiMappingId);
            }
            try {
                const domainInfo = yield this.getDomainInfoWs();
                yield this.printDomainSummaryWs(domainInfo);
            }
            catch (ex) {
                this.logIfDebug(ex.message);
                throw new Error("Unable to print websocket domain summary.");
            }
        });
    }
    /**
     * Adds the websocket domain name and distribution domain name to the CloudFormation outputs
     * @param domainInfo: Information about custom domain received from API gateway V2
     */
    addOutputsWs(domainInfo) {
        const service = this.serverless.service;
        if (!service.provider.compiledCloudFormationTemplate.Outputs) {
            service.provider.compiledCloudFormationTemplate.Outputs = {};
        }
        service.provider.compiledCloudFormationTemplate.Outputs.DomainName = {
            Value: domainInfo.domainName,
        };
        if (domainInfo.hostedZoneId) {
            service.provider.compiledCloudFormationTemplate.Outputs.HostedZoneId = {
                Value: domainInfo.hostedZoneId,
            };
        }
    }
    /**
     * Lifecycle function to create both HTTP and WSS domains
     * Wraps creating domains and resource record sets
     */
    createDomains() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.enabled) {
                    yield this.createDomain();
                }
                if (this.enabledWs) {
                    this.serverless.cli.log("Sleeping 30 seconds to workaround AWS 'too many requests' exception");
                    yield new Promise((done) => setTimeout(done, 30000));
                    yield this.createDomainWs();
                }
            }
            catch (err) {
                throw new Error(`Error: Unable to create custom domains.\n`);
            }
        });
    }
    /**
     * Lifecycle function to delete domains
     * Wraps deleting domains and resource record sets
     */
    deleteDomains() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.enabled) {
                    yield this.deleteDomain();
                }
                if (this.enabledWs) {
                    yield this.deleteDomainWs();
                }
            }
            catch (err) {
                this.logIfDebug(err.message);
            }
        });
    }
    /**
     * Lifecycle function to setup API mappings for HTTP and websocket endpoints
     */
    setupMappings() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.enabled) {
                    yield this.setupBasePathMapping();
                    if (this.enabledWs) {
                        this.serverless.cli.consoleLog(chalk_1.default.yellow("---"));
                    }
                }
                if (this.enabledWs) {
                    yield this.setupApiMappingWs();
                }
            }
            catch (err) {
                this.logIfDebug(err.message);
            }
        });
    }
    /**
     * Lifecycle function to remove API mappings for HTTP and websocket endpoints
     */
    removeMappings() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.enabled) {
                    yield this.deleteBasePathMapping();
                }
                if (this.enabledWs) {
                    const wssApiId = yield this.getWssApiId();
                    const currentApiMappingId = yield this.getApiMappingWs(wssApiId);
                    yield this.deleteApiMappingWs(wssApiId, currentApiMappingId);
                }
            }
            catch (err) {
                this.logIfDebug(err.message);
            }
        });
    }
    /**
     * Prints out a summary of all domain manager related info
     */
    printDomainSummary(domainInfo) {
        if (this.serverless.service.custom.customDomain.createRoute53Record !== false) {
            this.serverless.cli.consoleLog(chalk_1.default.yellow("Domain Name"));
            this.serverless.cli.consoleLog(`  ${this.givenDomainName}`);
        }
        this.serverless.cli.consoleLog(chalk_1.default.yellow("Distribution Domain Name"));
        this.serverless.cli.consoleLog(`  Target Domain: ${domainInfo.domainName}`);
        this.serverless.cli.consoleLog(`  Hosted Zone Id: ${domainInfo.hostedZoneId}`);
    }
    /**
     * Prints websocket custom domain summary
     * @param domainInfo: Information about custom domain received from API gateway V2
     */
    printDomainSummaryWs(domainInfo) {
        if (this.serverless.service.custom.customDomain.createRoute53Record !== false) {
            this.serverless.cli.consoleLog(chalk_1.default.yellow("Websockets Domain Name"));
            this.serverless.cli.consoleLog(`  ${this.givenDomainNameWs}`);
        }
        this.serverless.cli.consoleLog(chalk_1.default.yellow("Regional API Gateway Domain Name"));
        this.serverless.cli.consoleLog(`  ${domainInfo.apiGatewayDomainName}`);
        this.serverless.cli.consoleLog(chalk_1.default.yellow("Hosted Zone ID"));
        this.serverless.cli.consoleLog(`  ${domainInfo.hostedZoneId}`);
    }
}
module.exports = ServerlessCustomDomain;
