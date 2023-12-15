// import cds facade object (https://cap.cloud.sap/docs/node.js/cds-facade)
const cds = require('@sap/cds');
const { connect } = require('http2');

// Service Implementation with all service handlers
module.exports = cds.service.impl( async function(){

    // Define constants for Risks and BusinessPartners entities from risk-service.cds file
    const { Risks, BusinessPartners } = this.entities;

    // This handler will be executed directly AFTER a READ operation on RISKS
    // With this we can loop through the received data set and manipulate the single risk entries
    this.after("READ", Risks, (data) => {
        // convert to array, if it's only a single risk, so that code won't break her
        const risks = Array.isArray(data) ? data : [data];

        // Looping through the array of risks to set the virtual field 'Criticality' thay you defined in schema
        risks.forEach((risk) => {
            if( risk.impact >= 100000) {
                risk.criticality = 1;
            } else {
                risk.criticality = 2;
            }

            // set criticality for priority
            switch (risk.prio_code) {
                case 'H':
                    risk.PrioCriticality = 1;
                    break;
                case 'M':
                    risk.PrioCriticality = 2;
                    break;
                case 'L':
                    risk.PrioCriticality = 3;
                    break;
                default:
                    break;
            }
        })
    })

    // connect to remote service
    const BPsrv = await cds.connect.to("API_BUSINESS_PARTNER");

    /**
     * Event-handler for read-events on the BusinessPartner entity.
     * Each request to the API Business Hub requires the apikey in the header.
     */
    this.on("READ", BusinessPartners, async (req) => {
        // The API Sandbox returns many BusinessPartner with empty names.
        // we don't want them in application
        req.query.where("LastName <> '' and FirstName <> '' " );

        return await BPsrv.transaction(req).send({
            query: req.query,
            headers: {
                apikey: process.env.apikey,
            },
        });
    });

    // Risks?$expand=bp (Expand on BusinessPartner)
    this.on("READ", Risks, async (req,next) => {
        /* check whether request wants an expand of the business partner
           As this is not possible, risk entity and business partner entity are in different systems (SAP BTP and S/4 HANA Cloud),
           if there is such an expand, remove it */
           if(!req.query.SELECT.columns) return next();

           const expandIndex = req.query.SELECT.columns.findIndex(
            ({ expand, ref }) => expand && ref[0] === "bp"
           );
           
           if (expandIndex < 0) return next();

           //Remove expand from query
           req.query.SELECT.columns.splice(expandIndex,1);

           // Make Sure bp_BusinessPartner (ID) will be returned
           if (!req.query.SELECT.columns.find((column) => 
               column.ref.find((ref) => ref === "bp_BusinessPartner")
           )){
            req.query.SELECT.columns.push({ref: ["bp_BusinessPartner"]});
           }
           
           const risks = await next();

           const asArray = x => Array.isArray(x) ? x : [x];

           // Request all associated BusinessPartners
           const bpIDs = asArray(risks).map(risk => risk.bp_BusinessPartner);
           const businessPartners = await BPsrv.transaction(req).send({
            query: SELECT.from(this.entities.BusinessPartners).where({ BusinessPartner: bpIDs }),
            headers: {
                apikey: process.env.apikey,
            }
           });

           // Convert in a map for easier lookup
           const bpMap = {};
           for (const businessPartner of businessPartners)
               bpMap[businessPartner.BusinessPartner] = businessPartner;

           // Add BusinessPartners to result
           for (const note of asArray(risks)) {
            note.bp = bpMap[note.bp_BusinessPartner];
           }

           return risks;
    });

})