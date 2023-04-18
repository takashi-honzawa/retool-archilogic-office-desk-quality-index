import React, { useEffect, useRef } from 'react';
import { FloorPlanEngine } from '@archilogic/floor-plan-sdk'
import './FloorPlan.css'

import {
  startupSettings,
  defaultColors,
  valueToHex, 
  rgbToHex,
  hexToRgb,
  generateGradients,
  generateGradients3Colors,
  map, 
  arrayEquals,
  objectEquals,
  createLine
} from './utils'

let spaceColorObjects = []
let deskDistanceObjects = []
let deskIndexObjects = []

let midPoints = 10
let minColor = '#df9a9a'//'#eb4034'
let maxColor = '#21ff00'//'#00aeff'
let midColor = '#f1ff84'
//const gradientColors = generateGradients(minColor, maxColor)
const gradientColors = generateGradients3Colors(minColor, midColor, maxColor)

let outMin = 0
let outMax = midPoints - 1

let hasLoaded = false
let fpe
let layer
let colorScheme
let gradientMetric
let cursorMarker
let nearestMarkers = []

let desks
let deskCount
let selectedSpaces
let plants

let prevClickedAssetId

let prevIndex

let minMaxDistances
let minMaxIndex

const FloorPlan = ({ triggerQuery, model, modelUpdate }) => {
  const container = useRef(null);

  console.log('model', model)
  const { token, floorId } = model

  function addMarker(fpe, position, isCursorMarker, markerType = 'defalut-marker') {
    const el = document.createElement('div');
    el.className =  isCursorMarker ? "cursor-marker" : "icon-marker"
    el.classList.add(markerType)

    const marker = fpe.addHtmlMarker({
      el,
      pos: position,
      offset: [0, 0],
      radius: false,
    });
    return marker;
  }
  function getDistance(p1, p2) {
    let x = p2.x - p1.x;
    let y = p2.y - p1.y;
    return Math.sqrt(x * x + y * y);
  }
  function removeCursorMarker(){
    if (cursorMarker){
      cursorMarker.remove();
      cursorMarker = undefined
    }
  }
  function removeNearestMarkers(){
    if (nearestMarkers.length !== 0){
      nearestMarkers.forEach(marker => marker.remove())
      nearestMarkers = [];
    }
  }

  function selectSpacesAssets(resources){
    desks = resources.assets.filter(asset => asset.subCategories.includes("desk"))
    deskCount = desks.length

    const socializeUsages = ["lobby", "reception", "lounge", "cafe", "canteen", "pantry", "common", "hub"]
    const amenityUsages = ["cafe",  "canteen", "pantry", "kitchen", "printStation", "storage", "mailRoom"]
    const circulateUsages = ['corridor', 'foyer', 'staircase', 'elevator']

    const meetingRoom = resources.spaces.filter(space => space.program === "meet")
    const socializeSpace = resources.spaces.filter(space => socializeUsages.includes(space.usage))
    const amenity = resources.spaces.filter(space => amenityUsages.includes(space.usage))
    const circulate = resources.spaces.filter(space => circulateUsages.includes(space.usage))

    const restroom = resources.spaces.filter(space => space.usage === "restroom")
    const storage = resources.spaces.filter(space => space.usage === 'storage')
    const elevator = resources.spaces.filter(space => space.usage === 'elevator')
    const staircase = resources.spaces.filter(space => space.usage === 'staircase')

    // const hub = resources.spaces.filter(space => space.usage === 'hub')
    // const cafe = resources.spaces.filter(space => space.usage === 'cafe')
    // const pantry = resources.spaces.filter(space => space.usage === 'pantry')
    // const lounge = resources.spaces.filter(space => space.usage === 'lounge')

    selectedSpaces = {
      meetingRoom: meetingRoom,
      socializeSpace: socializeSpace,
      amenity: amenity,
      circulate: circulate,

      //only for icons
      restroom: restroom,
      storage: storage,
      elevator: elevator,
      staircase: staircase,

      // hub: hub,
      // cafe: cafe,
      // pantry: pantry,
      // lounge: lounge
    }

    const plant = resources.assets.filter(asset => asset.subCategories.includes('plant'))
        
    plants = {
      plant: plant
    }
  }

  function createSpaceColorObjects(spaceResources) {
    removeCursorMarker()
    removeNearestMarkers()
    
    if(model.colorScheme === "monochrome"){
      createMonochromeColors(spaceResources)
      colorScheme = 'monochrome'
    } else {
      createDefaultColors(spaceResources)
      colorScheme = 'default'
    }
  }
  function createDefaultColors(spaceResources){
    spaceColorObjects = []
    spaceResources.forEach(space => {
      if ( space.program ) {
        const color = defaultColors[space.program]
        const spaceColorObject = {
          space,
          displayData: { value: null, gradientIndex: null, color: color }
        }
        spaceColorObject.space.node.setHighlight({
          fill: color,
          fillOpacity: 0.4
        })
        spaceColorObjects.push(spaceColorObject)
      } else {
        const color = defaultColors['other']
        const spaceColorObject = {
          space,
          displayData: { value: null, gradientIndex: null, color: color }
        }
        spaceColorObject.space.node.setHighlight({
          fill: color,
          fillOpacity: 0.4
        })
        spaceColorObjects.push(spaceColorObject)
      }
    })
  }
  function createMonochromeColors(spaceResources){
    spaceColorObjects = []
    const color = [255, 255, 255]
    spaceResources.forEach(space => {
      const spaceColorObject = {
        space,
        displayData: { value: null, gradientIndex: null, color: color }
      }
      spaceColorObject.space.node.setHighlight({
        fill: color,
        fillOpacity: 0.4
      })
      spaceColorObjects.push(spaceColorObject)
    })
  }
  function setSpaceColorObjectFillOpacity(opacity){
    spaceColorObjects.forEach(spaceColorObject => {
      spaceColorObject.space.node.setHighlight({
        fill: spaceColorObject.displayData.color,
        fillOpacity: opacity
      })
    })
  }
    
  function createDeskDistanceObject(){
    // arrays of shortest distances to all space and asset type from each desk
    const resourcesForIndexCacl = ['meetingRoom', 'socializeSpace', 'amenity', 'circulate', 'plant']
    const shortestDistancesFromDesks = {}
    resourcesForIndexCacl.forEach(key => shortestDistancesFromDesks[key] = [])

    deskDistanceObjects = []
    //for each desk...
    for (const desk of desks){
      const deskDistanceObject = {desk: desk, distances: {}, closestResources: {}}

      //find distances to spaces of each type
      for (let spaceType in selectedSpaces){
        const spaceDistanceArr = []

        if(selectedSpaces[spaceType].length !== 0){
          selectedSpaces[spaceType].map(space => {
            const distance = getDistance({x: desk.position.x, y: desk.position.z}, {x: space.center[0], y: space.center[1]})
            spaceDistanceArr.push({distance, space})
          })
          spaceDistanceArr.sort((a, b) => a.distance - b.distance)          
          if(resourcesForIndexCacl.includes(spaceType)){
            shortestDistancesFromDesks[spaceType].push(spaceDistanceArr[0].distance)
            deskDistanceObject.distances[spaceType] = spaceDistanceArr[0].distance
          }
          deskDistanceObject.closestResources[spaceType] = spaceDistanceArr[0].space
        } else {
          shortestDistancesFromDesks[spaceType] = []
          deskDistanceObject.distances[spaceType] = undefined
        }
      }

      for (let plant in plants){
        const assetDistanceArr = []

        if(plants[plant].length !== 0){
          plants[plant].map(asset => {
            const distance = getDistance({x: desk.position.x, y: desk.position.z}, {x: asset.position.x, y: asset.position.z})
            assetDistanceArr.push({distance, asset})
          })
          assetDistanceArr.sort((a, b) => a.distance - b.distance)
          shortestDistancesFromDesks[plant].push(assetDistanceArr[0].distance)
          deskDistanceObject.distances[plant] = assetDistanceArr[0].distance
          deskDistanceObject.closestResources[plant] = assetDistanceArr[0].asset
        } else {
          shortestDistancesFromDesks[plant] = []
          deskDistanceObject.distances[plant] = undefined
        }
      }
      deskDistanceObjects.push(deskDistanceObject)
    }

    minMaxDistances = {}
    for (let spaceAssetType in shortestDistancesFromDesks){
      const length = shortestDistancesFromDesks[spaceAssetType].length
      shortestDistancesFromDesks[spaceAssetType].sort((a, b) => a - b)

      minMaxDistances[spaceAssetType] = {
        min: shortestDistancesFromDesks[spaceAssetType][0],
        max: shortestDistancesFromDesks[spaceAssetType][length - 1]
      }
    }
  }

  function calculateIndexForDesks(){
    deskIndexObjects = []

    const indexValueArr = {
      collaborative: [],
      quiet: []
    }
    
    deskDistanceObjects.forEach(desk => {
      const remappedValues = {}
      for (const metric in desk.distances) {
        
        const remappedFloat = map(desk.distances[metric], minMaxDistances[metric].min, minMaxDistances[metric].max, outMin, outMax)
        const remappedInt = Math.trunc(remappedFloat)//+ 1
        remappedValues[metric] = 10 - remappedInt
      }
      const deskMetricIndexObject = {...desk, metric: {}, index: {}}
      
      
      deskMetricIndexObject.metric['social'] = remappedValues.socializeSpace
      
      const noiseMetricArr = [remappedValues.socializeSpace, remappedValues.meetingRoom, remappedValues.circulate]
      noiseMetricArr.sort((a, b) => a - b)
      deskMetricIndexObject.metric['noise'] = noiseMetricArr[2]
      const invertedNoise = 10 - deskMetricIndexObject.metric.noise
      deskMetricIndexObject.metric['invertedNoise'] = invertedNoise

      deskMetricIndexObject.metric['amenity'] = remappedValues.amenity
      deskMetricIndexObject.metric['circulate'] = remappedValues.circulate
      deskMetricIndexObject.metric['green'] = remappedValues.plant

      const collabIndex = calculateIndex(deskMetricIndexObject.metric, 'collaborative')
      const quietIndex = calculateIndex(deskMetricIndexObject.metric, 'quiet')
      deskMetricIndexObject.index['collaborative'] = collabIndex
      deskMetricIndexObject.index['quiet'] = quietIndex

      deskIndexObjects.push(deskMetricIndexObject)

      indexValueArr.collaborative.push(collabIndex)
      indexValueArr.quiet.push(quietIndex)
    })
    minMaxIndex = {}
    for (let index in indexValueArr){
      const length = indexValueArr[index].length
      indexValueArr[index].sort((a, b) => a - b)
      minMaxIndex[index] = {
        min: indexValueArr[index][0],
        max: indexValueArr[index][length - 1]
      }
    }
  }
  function calculateIndex(metric, typeOfWork){
    const selectedMetricArr = {
      collaborative: ['social', 'amenity', 'circulate', 'green'],
      quiet: ['amenity', 'circulate', 'green', "invertedNoise"]
    }
    let sum = 0
    let count = 0
    selectedMetricArr[typeOfWork].forEach(string => {
      if(metric[string]){
        sum = sum + metric[string]
        count = count + 1
      }
    })
    return (sum / count).toFixed(2)
  }
  
  function applyGradients(){
    console.log('function fired')
    if(!model.index) return 
    if(prevIndex && prevIndex === model.index) return
  
    prevIndex = model.index

    deskIndexObjects.forEach(desk => {
      const remappedIndex = map(desk.index[model.index], minMaxIndex[model.index].min, minMaxIndex[model.index].max, outMin, outMax)
      const indexValueInt = Math.trunc(remappedIndex)
      const colorValue = gradientColors[indexValueInt]
      const color = hexToRgb(colorValue)
      desk.desk.node.setHighlight({
        fill: color,
        fillOpacity: 1
      })
    })
  }

  function onClick(fpe){
    if(!fpe) return
    
    fpe.on('click', (event) => {
      const position = event.pos
      const positionResources = fpe.getResourcesFromPosition(position)
      console.log('positionResources', positionResources)

      if(!positionResources.assets.length){
        removeCursorMarker()
        removeNearestMarkers()
        setSpaceColorObjectFillOpacity(0.4)
        return
      }
      
      const selectedAsset = positionResources.assets[0]

      if(selectedAsset.subCategories[0] !== 'desk') {
        removeCursorMarker()
        removeNearestMarkers()
        setSpaceColorObjectFillOpacity(0.4)
        return
      }

      if (prevClickedAssetId && prevClickedAssetId == selectedAsset.id) return
      prevClickedAssetId = selectedAsset.id
      
      //remove markers if exists
      removeCursorMarker()
      removeNearestMarkers()

      //add cursorMarker
      cursorMarker = addMarker(fpe, position, true)
      
      const match = deskIndexObjects.find(desk => desk.desk.id === selectedAsset.id)
      console.log('match', match)

      //add markers to nearest resources
      for (let resourceType in match.closestResources){
        const resource = match.closestResources[resourceType]
        if(resourceType === 'amenity' || resourceType === 'circulate'){
          console.log('no icon available atm')
        } else if(resourceType === 'plant'){
          const marker = addMarker(fpe, [resource.position.x, resource.position.z], false, resourceType)
          nearestMarkers.push(marker)
        } else {
          const marker = addMarker(fpe, [resource.center[0], resource.center[1]], false, resourceType)
          nearestMarkers.push(marker)
        }
      }
      modelUpdate({deskIndex: match.index, deskMetric: match.metric})
    })
  }

  async function initFloorPlan(){
    if(!token || !floorId) return
    
    fpe = new FloorPlanEngine({container: container.current, options: startupSettings})
    const fpeLoaded = await fpe.loadScene(floorId, {publishableAccessToken: token})
    hasLoaded = floorId
    prevIndex = undefined
    
    return fpe
  }
  useEffect(() => {
    if(fpe && hasLoaded === floorId) return
    if(container.current){
      initFloorPlan()
      .then((fpe) => {
        selectSpacesAssets(fpe.resources)
        createSpaceColorObjects(fpe.resources.spaces)
        createDeskDistanceObject()
        calculateIndexForDesks()
      })
    }
  })

  useEffect(() => {
    if(!fpe) return
    onClick(fpe)
    applyGradients()
    if(model.colorScheme === colorScheme) return
    if(!colorScheme) return
    createSpaceColorObjects(fpe.resources.spaces)
  })
  
  return(
    <div className='fpe' id="floor-plan" ref={container}></div>
  )
}

export default FloorPlan